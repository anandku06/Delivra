import { eq, and, inArray, desc, sql, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  emailCampaigns,
  scheduledEmails,
  senders,
  EMAIL_STATUS,
  CAMPAIGN_STATUS,
  type EmailCampaign,
  type ScheduledEmail,
} from "../../db/schema.js";
import { addEmailJob, emailQueue } from "../../queue/emailQueue.js";
import type { ScheduleEmailInput } from "./email.validator.js";

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Enqueue BullMQ delayed jobs for a set of already-inserted email records.
 * Records the bull_job_id back to the DB for each job that is successfully queued.
 *
 * Returns the count of jobs successfully enqueued.
 *
 * This is deliberately separated from the DB transaction so that:
 *   - The DB records are committed even if some enqueues fail.
 *   - recoverUnqueuedEmails() can find and re-enqueue any missed records on
 *     the next startup.
 */
async function enqueueEmailJobs(
  emails: Pick<ScheduledEmail, "id" | "senderId" | "recipient" | "scheduledTime">[],
  subject: string,
  body: string,
  now: Date
): Promise<number> {
  let enqueued = 0;

  for (const email of emails) {
    const delayMs = Math.max(0, email.scheduledTime.getTime() - now.getTime());

    try {
      await addEmailJob(
        {
          emailId: email.id,
          senderId: email.senderId,
          recipient: email.recipient,
          subject,
          body,
        },
        delayMs
      );

      // Record the stable job ID back to the DB row so we can look it up later.
      await db
        .update(scheduledEmails)
        .set({ bullJobId: `email-${email.id}` })
        .where(eq(scheduledEmails.id, email.id));

      enqueued++;
    } catch (err) {
      // Log but do not abort — the DB row is SCHEDULED with bullJobId = NULL.
      // recoverUnqueuedEmails() will pick this up on the next server start.
      console.error(
        `⚠️  Failed to enqueue job for email ${email.id} (${email.recipient}): ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return enqueued;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Core scheduling logic:
 * 1. Pick an available sender
 * 2. Create campaign record (inside DB transaction)
 * 3. Insert individual scheduled_email rows with computed times (inside DB transaction)
 * 4. Commit transaction
 * 5. Enqueue BullMQ delayed jobs (outside transaction — cannot be made atomic with PG)
 *
 * Root cause addressed (C1): Previously all of these steps were sequential with no
 * transaction. A crash mid-loop left orphaned campaign + partial email rows in the DB
 * with no corresponding BullMQ jobs, and no way to detect or recover them.
 *
 * Recovery: Any email record left in SCHEDULED state with bullJobId = NULL will be
 * detected and re-enqueued by recoverUnqueuedEmails() on the next server start.
 */
export async function scheduleEmails(
  input: ScheduleEmailInput,
  userId: string
): Promise<{ campaign: EmailCampaign; emailCount: number }> {
  // 1. Pick an enabled sender — simple first-enabled pick for now
  const sender = await db.query.senders.findFirst({
    where: eq(senders.enabled, true),
    orderBy: senders.createdAt,
  });

  if (!sender) {
    throw new Error("No enabled senders available. Please configure a sender.");
  }

  const startTime = new Date(input.startTime);
  const now = new Date();

  // 2. Pre-compute the scheduled time for each recipient
  const emailRows: {
    campaignId: string;
    senderId: string;
    recipient: string;
    scheduledTime: Date;
    status: string;
  }[] = [];

  // Placeholder — campaignId will be filled inside the transaction
  // We build the per-recipient timing data here so the loop is outside the tx.
  const timingData: { recipient: string; scheduledTime: Date }[] =
    input.recipients.map((recipient, i) => {
      // Within each hourly chunk, space by delayBetweenEmails seconds
      const posInChunk = i % input.hourlyLimit;
      const hourChunk = Math.floor(i / input.hourlyLimit);
      const offsetSeconds =
        hourChunk * 3600 + posInChunk * input.delayBetweenEmails;

      return {
        recipient,
        scheduledTime: new Date(startTime.getTime() + offsetSeconds * 1000),
      };
    });

  // 3. Atomic DB write: campaign + all email rows in one transaction
  let campaign!: EmailCampaign;
  let insertedEmails: ScheduledEmail[] = [];

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(emailCampaigns)
      .values({
        userId,
        subject: input.subject,
        body: input.body,
        startTime,
        delayBetweenEmails: input.delayBetweenEmails,
        hourlyLimit: input.hourlyLimit,
        totalRecipients: input.recipients.length,
        status: CAMPAIGN_STATUS.CREATED,
      })
      .returning();

    if (!created) throw new Error("Failed to create campaign");
    campaign = created;

    // Build email rows now that we have the campaign ID
    for (const { recipient, scheduledTime } of timingData) {
      emailRows.push({
        campaignId: campaign.id,
        senderId: sender.id,
        recipient,
        scheduledTime,
        status: EMAIL_STATUS.SCHEDULED,
      });
    }

    insertedEmails = await tx
      .insert(scheduledEmails)
      .values(emailRows)
      .returning();
  });
  // ↑ If anything above throws, the transaction rolls back — no orphaned records.

  // 4. Enqueue BullMQ jobs OUTSIDE the transaction (Redis is not part of PG txn)
  const enqueued = await enqueueEmailJobs(
    insertedEmails,
    input.subject,
    input.body,
    now
  );

  if (enqueued < insertedEmails.length) {
    console.warn(
      `⚠️  Enqueued ${enqueued}/${insertedEmails.length} jobs for campaign ${campaign.id}. ` +
      `Remaining will be recovered on next startup via recoverUnqueuedEmails().`
    );
  }

  // 5. Mark campaign as PROCESSING
  await db
    .update(emailCampaigns)
    .set({ status: CAMPAIGN_STATUS.PROCESSING })
    .where(eq(emailCampaigns.id, campaign.id));

  return { campaign, emailCount: insertedEmails.length };
}

/**
 * Recovery function — call once on server startup.
 *
 * Finds all SCHEDULED email records that have no bullJobId. These are emails
 * whose DB rows were committed inside a transaction but whose BullMQ enqueue
 * call failed (network error, Redis restart, process crash) before bullJobId
 * was written back.
 *
 * For each such email, re-enqueues the job and records the bullJobId. If the
 * job already exists in Redis under its deterministic ID (from a previous partial
 * recovery), addEmailJob's deterministic ID causes BullMQ to return the existing
 * job instead of creating a duplicate.
 *
 * Design note: this does not handle emails whose bullJobId IS set but whose Redis
 * job was lost (e.g. Redis data loss without AOF/RDB). That scenario requires
 * checking each bullJobId against the queue, which is more expensive and is
 * documented as a known limitation.
 */
export async function recoverUnqueuedEmails(): Promise<void> {
  const pending = await db
    .select({
      id: scheduledEmails.id,
      senderId: scheduledEmails.senderId,
      recipient: scheduledEmails.recipient,
      scheduledTime: scheduledEmails.scheduledTime,
      campaignId: scheduledEmails.campaignId,
    })
    .from(scheduledEmails)
    .where(
      and(
        inArray(scheduledEmails.status, [
          EMAIL_STATUS.SCHEDULED,
          EMAIL_STATUS.RATE_LIMITED,
        ]),
        isNull(scheduledEmails.bullJobId)
      )
    );

  if (pending.length === 0) return;

  console.log(
    `🔄 Recovery: found ${pending.length} unqueued email(s) with no queue job. Re-enqueuing...`
  );

  const now = new Date();

  for (const email of pending) {
    const campaign = await db.query.emailCampaigns.findFirst({
      where: eq(emailCampaigns.id, email.campaignId),
    });

    if (!campaign) {
      console.warn(`⚠️  Recovery: campaign ${email.campaignId} not found for email ${email.id}`);
      continue;
    }

    const delayMs = Math.max(0, email.scheduledTime.getTime() - now.getTime());

    try {
      await addEmailJob(
        {
          emailId: email.id,
          senderId: email.senderId,
          recipient: email.recipient,
          subject: campaign.subject,
          body: campaign.body,
        },
        delayMs
      );

      await db
        .update(scheduledEmails)
        .set({ bullJobId: `email-${email.id}` })
        .where(eq(scheduledEmails.id, email.id));

      console.log(`   ✅ Recovered email ${email.id} → ${email.recipient}`);
    } catch (err) {
      console.error(
        `   ❌ Recovery failed for email ${email.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * Get all scheduled (pending) emails for a user.
 */
export async function getScheduledEmails(userId: string) {
  const results = await db
    .select({
      id: scheduledEmails.id,
      recipient: scheduledEmails.recipient,
      subject: emailCampaigns.subject,
      scheduledTime: scheduledEmails.scheduledTime,
      status: scheduledEmails.status,
      campaignId: scheduledEmails.campaignId,
    })
    .from(scheduledEmails)
    .innerJoin(
      emailCampaigns,
      eq(scheduledEmails.campaignId, emailCampaigns.id)
    )
    .where(
      and(
        eq(emailCampaigns.userId, userId),
        inArray(scheduledEmails.status, [
          EMAIL_STATUS.SCHEDULED,
          EMAIL_STATUS.PROCESSING,
          EMAIL_STATUS.RATE_LIMITED,
        ])
      )
    )
    .orderBy(scheduledEmails.scheduledTime);

  return results;
}

/**
 * Get all sent/failed emails for a user.
 */
export async function getSentEmails(userId: string) {
  const results = await db
    .select({
      id: scheduledEmails.id,
      recipient: scheduledEmails.recipient,
      subject: emailCampaigns.subject,
      sentAt: scheduledEmails.sentAt,
      status: scheduledEmails.status,
      error: scheduledEmails.error,
      campaignId: scheduledEmails.campaignId,
    })
    .from(scheduledEmails)
    .innerJoin(
      emailCampaigns,
      eq(scheduledEmails.campaignId, emailCampaigns.id)
    )
    .where(
      and(
        eq(emailCampaigns.userId, userId),
        inArray(scheduledEmails.status, [
          EMAIL_STATUS.SENT,
          EMAIL_STATUS.FAILED,
        ])
      )
    )
    .orderBy(desc(scheduledEmails.sentAt));

  return results;
}

/**
 * Get all campaigns for a user.
 */
export async function getCampaigns(userId: string) {
  const results = await db
    .select({
      id: emailCampaigns.id,
      subject: emailCampaigns.subject,
      startTime: emailCampaigns.startTime,
      totalRecipients: emailCampaigns.totalRecipients,
      status: emailCampaigns.status,
      delayBetweenEmails: emailCampaigns.delayBetweenEmails,
      hourlyLimit: emailCampaigns.hourlyLimit,
      createdAt: emailCampaigns.createdAt,
      sentCount: sql<number>`(
        SELECT COUNT(*) FROM scheduled_emails
        WHERE campaign_id = ${emailCampaigns.id}
        AND status = 'SENT'
      )`.as("sent_count"),
      failedCount: sql<number>`(
        SELECT COUNT(*) FROM scheduled_emails
        WHERE campaign_id = ${emailCampaigns.id}
        AND status = 'FAILED'
      )`.as("failed_count"),
    })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.userId, userId))
    .orderBy(desc(emailCampaigns.createdAt));

  return results;
}

/**
 * Delete a scheduled email if it hasn't been sent yet.
 * Also removes the corresponding BullMQ job.
 */
export async function deleteScheduledEmail(emailId: string, userId: string) {
  // Verify the email belongs to this user and is still deletable
  const [email] = await db
    .select({
      id: scheduledEmails.id,
      status: scheduledEmails.status,
      bullJobId: scheduledEmails.bullJobId,
      userId: emailCampaigns.userId,
    })
    .from(scheduledEmails)
    .innerJoin(
      emailCampaigns,
      eq(scheduledEmails.campaignId, emailCampaigns.id)
    )
    .where(
      and(
        eq(scheduledEmails.id, emailId),
        eq(emailCampaigns.userId, userId)
      )
    )
    .limit(1);

  if (!email) {
    throw new Error("Email not found");
  }

  if (email.status === EMAIL_STATUS.SENT) {
    throw new Error("Cannot delete an already sent email");
  }

  // Remove the BullMQ job if it exists
  if (email.bullJobId) {
    try {
      const job = await emailQueue.getJob(email.bullJobId);
      if (job) {
        await job.remove();
      }
    } catch {
      // Job may already be processed or removed — that's fine
    }
  }

  // Delete the row from the database
  await db
    .delete(scheduledEmails)
    .where(eq(scheduledEmails.id, emailId));

  return { deleted: true };
}
