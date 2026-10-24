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
      count: 5000,    // Keep at most 5000 completed jobs
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
 * if the same emailId is added twice while the job is still active,
 * BullMQ will return the existing job rather than creating a duplicate.
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
 *
 * Root cause fixed: the previous implementation appended `Date.now()` to the
 * job ID on each reschedule, producing a non-deterministic ID. Two concurrent
 * reschedule calls for the same email could both succeed, leaving two live
 * delayed jobs — meaning the email would be sent twice.
 *
 * Fix strategy:
 *   1. Use the same deterministic ID (`email-{emailId}`) that the original job had.
 *   2. Explicitly remove the existing job from whatever state it is in
 *      (delayed, completed, failed, etc.) before re-adding.
 *   3. BullMQ's job ID uniqueness then guarantees that concurrent races resolve
 *      to exactly one live job: the second concurrent add will either return the
 *      job that the first add already created (if it arrived after step 2 of the
 *      first call) or silently de-duplicate.
 *
 * Traceability is preserved because the ID never changes from the email's
 * perspective: it is always `email-{emailId}`.
 */
export async function rescheduleEmailJob(
  payload: EmailJobPayload,
  newDelayMs: number
): Promise<string> {
  const jobId = `email-${payload.emailId}`;

  // Remove the existing job from any state (delayed, waiting, completed, failed)
  // so we can re-add with the same deterministic ID.
  const existingJob = await emailQueue.getJob(jobId);
  if (existingJob) {
    try {
      await existingJob.remove();
    } catch {
      // Job may already have been removed by another worker — that is fine.
    }
  }

  const job = await emailQueue.add("send-email", payload, {
    jobId,
    delay: Math.max(0, newDelayMs),
  });

  return job.id ?? jobId;
}
