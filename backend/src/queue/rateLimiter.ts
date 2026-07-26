import { createRedisConnection } from "./connection.js";
import { env } from "../config/env.js";

/**
 * Redis-backed distributed hourly rate limiter.
 *
 * Uses atomic INCR + EXPIRE to track sends per sender per hour window.
 * Key format: `rate:{senderId}:{YYYYMMDDHH}`
 *
 * This is safe across multiple workers / instances because Redis INCR is atomic.
 */

const redis = createRedisConnection();

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  resetAt: Date;
}

/**
 * Get the hour window key for a given timestamp.
 * Format: YYYYMMDDHH (e.g., "2026072515" for July 25, 2026, 3 PM)
 */
function getHourWindow(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}${month}${day}${hour}`;
}

/**
 * Get the start of the next hour from a given date.
 */
function getNextHourStart(date: Date = new Date()): Date {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

/**
 * Lua script for atomic increment with limit check.
 * Returns: [current_count, is_new_key]
 *
 * This ensures the INCR and EXPIRE happen atomically,
 * preventing race conditions between workers.
 */
const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local ttl = tonumber(ARGV[2])

  local current = redis.call('INCR', key)

  if current == 1 then
    redis.call('EXPIRE', key, ttl)
  end

  return current
`;

/**
 * Try to consume one rate limit unit for a sender in the current hour.
 *
 * @param senderId - The sender's UUID
 * @param hourlyLimit - Override the default MAX_EMAILS_PER_HOUR (e.g., per-campaign limit)
 */
export async function tryConsume(
  senderId: string,
  hourlyLimit?: number
): Promise<RateLimitResult> {
  const limit = hourlyLimit ?? env.MAX_EMAILS_PER_HOUR;
  const now = new Date();
  const windowKey = `rate:${senderId}:${getHourWindow(now)}`;
  const ttl = 7200; // 2 hours — gives enough buffer for cleanup

  // Atomic increment using Lua
  const current = (await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    windowKey,
    limit.toString(),
    ttl.toString()
  )) as number;

  const resetAt = getNextHourStart(now);

  if (current > limit) {
    // Decrement back since we're not actually consuming
    await redis.decr(windowKey);

    return {
      allowed: false,
      current: current - 1,
      limit,
      resetAt,
    };
  }

  return {
    allowed: true,
    current,
    limit,
    resetAt,
  };
}

/**
 * Get the delay in milliseconds until the next hour window opens.
 */
export function getDelayUntilNextHour(): number {
  const now = new Date();
  const nextHour = getNextHourStart(now);
  return nextHour.getTime() - now.getTime();
}

/**
 * Get the current rate limit status for a sender (without consuming).
 */
export async function getStatus(
  senderId: string
): Promise<{ current: number; limit: number; resetAt: Date }> {
  const now = new Date();
  const windowKey = `rate:${senderId}:${getHourWindow(now)}`;
  const current = parseInt((await redis.get(windowKey)) ?? "0", 10);

  return {
    current,
    limit: env.MAX_EMAILS_PER_HOUR,
    resetAt: getNextHourStart(now),
  };
}
