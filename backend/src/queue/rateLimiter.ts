import { createRedisConnection } from "./connection.js";
import { env } from "../config/env.js";

/**
 * Redis-backed distributed hourly rate limiter.
 *
 * Uses atomic Lua scripting to track sends per sender per hour window.
 * Key format: `rate:{senderId}:{YYYYMMDDHH}`
 *
 * Safe across multiple workers / instances because the entire check-and-increment
 * is executed atomically inside a single Lua script — no separate DECR needed.
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
 * Format: YYYYMMDDHH (e.g., "2026072515" for July 25, 2026, 3 PM UTC)
 */
export function getHourWindow(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}${month}${day}${hour}`;
}

/**
 * Get the start of the next hour from a given date.
 */
export function getNextHourStart(date: Date = new Date()): Date {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

/**
 * Atomic Lua script: check the current count and increment ONLY if below the limit.
 *
 * Returns: [allowed, current_count]
 *   allowed == 1  → quota consumed, proceed with send
 *   allowed == 0  → limit reached, do not send
 *
 * Root cause fix: the previous implementation used INCR then a separate DECR when
 * over limit. The gap between those two Redis calls is a race window — another
 * worker could read the inflated count and allow an extra send. This script
 * checks and conditionally increments in one atomic operation, closing that window.
 */
const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local ttl   = tonumber(ARGV[2])

  local raw = redis.call('GET', key)
  local current = raw and tonumber(raw) or 0

  if current >= limit then
    return {0, current}
  end

  local new_val = redis.call('INCR', key)
  if new_val == 1 then
    redis.call('EXPIRE', key, ttl)
  end

  return {1, new_val}
`;

/**
 * Try to consume one rate-limit unit for a sender in the current hour window.
 *
 * @param senderId   - The sender's UUID
 * @param hourlyLimit - Override the default MAX_EMAILS_PER_HOUR (e.g., per-campaign limit)
 */
export async function tryConsume(
  senderId: string,
  hourlyLimit?: number
): Promise<RateLimitResult> {
  const limit = hourlyLimit ?? env.MAX_EMAILS_PER_HOUR;
  const now = new Date();
  const windowKey = `rate:${senderId}:${getHourWindow(now)}`;
  const ttl = 7200; // 2 hours — buffer for cleanup

  // Returns [allowed(0|1), current_count]
  const result = (await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    windowKey,
    limit.toString(),
    ttl.toString()
  )) as [number, number];

  const [allowed, current] = result;
  const resetAt = getNextHourStart(now);

  return {
    allowed: allowed === 1,
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
 * Get the current rate-limit status for a sender (without consuming quota).
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
