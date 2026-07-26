import { Queue } from "bullmq";
import { createRedisConnection } from "./connection.js";

export interface EmailJobPayload {
  emailId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
}

export const EMAIL_QUEUE_NAME = "email-send";

/**
 * The main email-send queue.
 * All email jobs are added here with a computed delay.
 */
export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 5000,     // Keep at most 5000 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s, 10s, 20s
    },
  },
});

/**
 * Add a delayed email job to the queue.
 *
 * Uses a deterministic job ID (`email:{emailId}`) to guarantee idempotency —
 * if the same emailId is added twice, BullMQ will reject the duplicate.
 */
export async function addEmailJob(
  payload: EmailJobPayload,
  delayMs: number
): Promise<string> {
  const jobId = `email-${payload.emailId}`;

  const job = await emailQueue.add("send-email", payload, {
    jobId,
    delay: Math.max(0, delayMs),
  });

  return job.id ?? jobId;
}

/**
 * Re-add a job with a new delay (used when rate-limited).
 * Removes the old job first, then adds a new one with updated delay.
 */
export async function rescheduleEmailJob(
  payload: EmailJobPayload,
  newDelayMs: number
): Promise<string> {
  const jobId = `email-${payload.emailId}`;

  // Remove the old job if it exists
  const existingJob = await emailQueue.getJob(jobId);
  if (existingJob) {
    await existingJob.remove();
  }

  // Add with a new unique ID suffix to avoid collision
  const rescheduleId = `email-${payload.emailId}-r${Date.now()}`;

  const job = await emailQueue.add("send-email", payload, {
    jobId: rescheduleId,
    delay: Math.max(0, newDelayMs),
  });

  return job.id ?? rescheduleId;
}
