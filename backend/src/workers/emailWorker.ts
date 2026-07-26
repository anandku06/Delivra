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
 * 2. Checks rate limits (reschedule if over limit)
 * 3. Sends via Ethereal SMTP
 * 4. Updates DB status
 *
 * Concurrency is configurable via WORKER_CONCURRENCY env var.
 */
export function startEmailWorker(): Worker<EmailJobPayload> {
  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobPayload>) => {
      const { emailId, senderId, recipient, subject, body } = job.data;

      console.log(`🔧 Processing job ${job.id} → ${recipient}`);

      // ─── 1. Idempotency Check ──────────────────────────────────────────
      const emailRecord = await db.query.scheduledEmails.findFirst({
        where: eq(scheduledEmails.id, emailId),
      });

      if (!emailRecord) {
        console.warn(`⚠️ Email record ${emailId} not found. Skipping.`);
        return;
      }

      if (emailRecord.status === EMAIL_STATUS.SENT) {
        console.log(`⏭️ Email ${emailId} already sent. Skipping.`);
        return;
      }

      // ─── 2. Mark as Processing ─────────────────────────────────────────
      await db
        .update(scheduledEmails)
        .set({ status: EMAIL_STATUS.PROCESSING })
        .where(eq(scheduledEmails.id, emailId));

      // ─── 3. Rate Limit Check ───────────────────────────────────────────
      // Fetch campaign to get per-campaign hourly limit
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

        // Reschedule the job
        await rescheduleEmailJob(job.data, delayMs);

        // Update DB
        await db
          .update(scheduledEmails)
          .set({
            status: EMAIL_STATUS.RATE_LIMITED,
            scheduledTime: rateLimitResult.resetAt,
          })
          .where(eq(scheduledEmails.id, emailId));

        return; // Job completes; new delayed job takes over
      }

      // ─── 4. Get Sender Details ─────────────────────────────────────────
      const sender = await db.query.senders.findFirst({
        where: eq(senders.id, senderId),
      });

      if (!sender) {
        throw new Error(`Sender ${senderId} not found`);
      }

      // ─── 5. Send Email ─────────────────────────────────────────────────
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
          })
          .where(eq(scheduledEmails.id, emailId));

        console.log(`✅ Email ${emailId} sent to ${recipient} (${result.messageId})`);

        // Check if campaign is complete
        await checkCampaignCompletion(emailRecord.campaignId);

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`❌ Failed to send email ${emailId}: ${errorMsg}`);

        await db
          .update(scheduledEmails)
          .set({
            status: EMAIL_STATUS.FAILED,
            error: errorMsg,
            attempts: (emailRecord.attempts ?? 0) + 1,
          })
          .where(eq(scheduledEmails.id, emailId));

        throw err; // Let BullMQ handle retries
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: env.WORKER_CONCURRENCY,
      // Stalled job settings — if a job takes too long, mark it stalled
      stalledInterval: 30000, // Check every 30s
      maxStalledCount: 2,     // Max 2 stalls before failing
    }
  );

  // ─── Worker Event Handlers ──────────────────────────────────────────────────

  worker.on("ready", () => {
    console.log(
      `🚀 Email worker ready (concurrency: ${env.WORKER_CONCURRENCY})`
    );
  });

  worker.on("completed", (job) => {
    console.log(`✔️ Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`💥 Job ${job?.id} failed: ${err.message}`);
  });

  worker.on("error", (err) => {
    console.error("❌ Worker error:", err.message);
  });

  worker.on("stalled", (jobId) => {
    console.warn(`⚠️ Job ${jobId} stalled`);
  });

  return worker;
}

/**
 * Check if all emails in a campaign have been sent/failed,
 * and update the campaign status to COMPLETED if so.
 */
async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const campaign = await db.query.emailCampaigns.findFirst({
    where: eq(emailCampaigns.id, campaignId),
  });

  if (!campaign) return;

  // Count remaining emails that are not in a terminal state
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
