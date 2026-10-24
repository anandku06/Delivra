import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { scheduledEmails, senders, emailCampaigns, EMAIL_STATUS, CAMPAIGN_STATUS } from "../db/schema.js";
import { EMAIL_QUEUE_NAME, type EmailJobPayload, rescheduleEmailJob } from "../queue/emailQueue.js";
import { tryConsume, getDelayUntilNextHour } from "../queue/rateLimiter.js";
import { sendEmail } from "../sender/mailer.js";
import { createRedisConnection } from "../queue/connection.js";
import { env } from "../config/env.js";

/**
 * Create and start the BullMQ worker for processing email send jobs.
 *
 * The worker:
 * 1. Checks idempotency (skip if already SENT)
 * 2. Marks PROCESSING and clears any stale error from a previous attempt
 * 3. Checks distributed rate limit (reschedule if over limit)
 * 4. Sends via Ethereal SMTP
 * 5. Updates DB status
 *
 * Stalled / exhausted-retry handling (C4 / C5 fix):
 *   The `failed` event fires for every failure, including stalls that BullMQ
 *   marks as failed after maxStalledCount. The processor itself cannot catch a
 *   stall (the process was killed). We rely on the `failed` event to set the DB
 *   to FAILED when all attempts are exhausted, ensuring the DB never gets stuck
 *   permanently in PROCESSING.
 *
 * Concurrency is configurable via WORKER_CONCURRENCY env var.
 */
export function startEmailWorker(): Worker<EmailJobPayload> {
  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobPayload>) => {
      const { emailId, senderId, recipient, subject, body } = job.data;

      console.log(`🔧 Processing job ${job.id} (attempt ${job.attemptsMade + 1}) → ${recipient}`);

      // ─── 1. Idempotency Check ────────────────────────────────────────────
      const emailRecord = await db.query.scheduledEmails.findFirst({
        where: eq(scheduledEmails.id, emailId),
      });

      if (!emailRecord) {
        console.warn(`⚠️ Email record ${emailId} not found. Skipping.`);
        return; // Treat as a no-op — avoids crashing for deleted records
      }

      if (emailRecord.status === EMAIL_STATUS.SENT) {
        console.log(`⏭️ Email ${emailId} already sent. Skipping.`);
        return;
      }

      // ─── 2. Mark as Processing — clear stale error from previous attempt ─
      //
      // Root cause addressed (C5): On a retry, the DB might be in FAILED from
      // the previous attempt. Setting it back to PROCESSING + clearing error
      // ensures the UI shows the correct in-progress state and a stale error
      // from a transient failure is not permanently visible.
      await db
        .update(scheduledEmails)
        .set({
          status: EMAIL_STATUS.PROCESSING,
          error: null,             // clear error from previous attempt
        })
        .where(eq(scheduledEmails.id, emailId));

      // ─── 3. Rate Limit Check ─────────────────────────────────────────────
      const campaign = await db.query.emailCampaigns.findFirst({
        where: eq(emailCampaigns.id, emailRecord.campaignId),
      });

      const hourlyLimit = campaign?.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR;
      const rateLimitResult = await tryConsume(senderId, hourlyLimit);

      if (!rateLimitResult.allowed) {
        console.log(
          `🚦 Rate limit hit for sender ${senderId} ` +
          `(${rateLimitResult.current}/${rateLimitResult.limit}). ` +
          `Rescheduling to next hour.`
        );

        const delayMs = getDelayUntilNextHour() + 1000; // +1s buffer

        await rescheduleEmailJob(job.data, delayMs);

        await db
          .update(scheduledEmails)
          .set({
            status: EMAIL_STATUS.RATE_LIMITED,
            scheduledTime: rateLimitResult.resetAt,
          })
          .where(eq(scheduledEmails.id, emailId));

        return; // This job completes; new delayed job takes over
      }

      // ─── 4. Get Sender Details ───────────────────────────────────────────
      const sender = await db.query.senders.findFirst({
        where: eq(senders.id, senderId),
      });

      if (!sender) {
        throw new Error(`Sender ${senderId} not found`);
      }

      // ─── 5. Send Email ───────────────────────────────────────────────────
      try {
        const result = await sendEmail({
          from: `"${sender.name}" <${sender.smtpUser}>`,
          to: recipient,
          subject,
          body,
        });

        // ─── 6. Update DB: Success ─────────────────────────────────────
        await db
          .update(scheduledEmails)
          .set({
            status: EMAIL_STATUS.SENT,
            sentAt: new Date(),
            attempts: (emailRecord.attempts ?? 0) + 1,
            error: null,
          })
          .where(eq(scheduledEmails.id, emailId));

        console.log(`✅ Email ${emailId} sent to ${recipient} (${result.messageId})`);

        await checkCampaignCompletion(emailRecord.campaignId);

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`❌ Failed to send email ${emailId}: ${errorMsg}`);

        // Update the DB attempt count; status will be set in the `failed` event
        // handler once we know whether this was the final attempt or a transient
        // failure that BullMQ will retry.
        await db
          .update(scheduledEmails)
          .set({
            attempts: (emailRecord.attempts ?? 0) + 1,
          })
          .where(eq(scheduledEmails.id, emailId));

        throw err; // Let BullMQ handle retries / final failure
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: env.WORKER_CONCURRENCY,
      stalledInterval: 30_000, // Check for stalled jobs every 30s
      maxStalledCount: 2,      // Max 2 stalls before marking failed
    }
  );

  // ─── Worker Event Handlers ─────────────────────────────────────────────────

  worker.on("ready", () => {
    console.log(`🚀 Email worker ready (concurrency: ${env.WORKER_CONCURRENCY})`);
  });

  worker.on("completed", (job) => {
    console.log(`✔️  Job ${job.id} completed`);
  });

  /**
   * `failed` fires for every failure — both transient (will be retried) and final
   * (all attempts exhausted). We only update the DB to permanently FAILED when
   * attemptsMade >= configured attempts, i.e. no more retries will happen.
   *
   * Root cause addressed (C5): Previously, stalled jobs (where the worker process
   * was killed mid-processing) left the DB record in PROCESSING forever because
   * BullMQ marks the job as failed without invoking the processor's catch block.
   */
  worker.on("failed", async (job, err) => {
    const jobId = job?.id ?? "unknown";
    console.error(`💥 Job ${jobId} failed (attempt ${job?.attemptsMade ?? "?"}): ${err.message}`);

    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;
    const isExhausted = job.attemptsMade >= maxAttempts;

    if (isExhausted) {
      // All retries used up — mark DB as permanently FAILED
      console.error(
        `🚫 Job ${jobId} exhausted all ${maxAttempts} attempts. Marking email ${job.data.emailId} as FAILED.`
      );

      try {
        await db
          .update(scheduledEmails)
          .set({
            status: EMAIL_STATUS.FAILED,
            error: `${err.message} (exhausted ${maxAttempts} attempts)`,
          })
          .where(eq(scheduledEmails.id, job.data.emailId));
      } catch (dbErr) {
        console.error(
          `❌ Could not update DB after job exhaustion for email ${job.data.emailId}:`,
          dbErr
        );
      }
    }
    // If NOT exhausted, BullMQ will retry. The processor sets the DB back to
    // PROCESSING at the start of the next attempt, clearing the error field.
  });

  worker.on("error", (err) => {
    console.error("❌ Worker error:", err.message);
  });

  worker.on("stalled", (jobId) => {
    console.warn(`⚠️  Job ${jobId} stalled — will be retried or failed by BullMQ`);
  });

  return worker;
}

/**
 * Check if all emails in a campaign have reached a terminal state,
 * and update the campaign status to COMPLETED if so.
 */
async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const campaign = await db.query.emailCampaigns.findFirst({
    where: eq(emailCampaigns.id, campaignId),
  });

  if (!campaign) return;

  const remaining = await db.query.scheduledEmails.findFirst({
    where: (fields, { and, eq, notInArray }) =>
      and(
        eq(fields.campaignId, campaignId),
        notInArray(fields.status, [EMAIL_STATUS.SENT, EMAIL_STATUS.FAILED])
      ),
  });

  if (!remaining) {
    await db
      .update(emailCampaigns)
      .set({ status: CAMPAIGN_STATUS.COMPLETED })
      .where(eq(emailCampaigns.id, campaignId));

    console.log(`🎉 Campaign ${campaignId} completed`);
  }
}
