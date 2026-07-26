import IORedis from "ioredis";
import { env } from "../config/env.js";

/**
 * Shared IORedis connection for BullMQ Queue and Worker.
 * BullMQ requires IORedis (not node-redis).
 *
 * maxRetriesPerRequest: null is required by BullMQ.
 */
export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5000);
    console.log(`🔄 Redis reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
});

redisConnection.on("connect", () => {
  console.log("✅ Redis connected");
});

redisConnection.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

/**
 * Creates a new IORedis connection (BullMQ needs separate connections
 * for Queue and Worker — they cannot share the same instance).
 */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
