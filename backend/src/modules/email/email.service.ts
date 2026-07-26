import { eq, and, inArray, desc, sql } from "drizzle-orm";
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
import { addEmailJob } from "../../queue/emailQueue.js";
import type { ScheduleEmailInput } from "./email.validator.js";

/**
 * Core scheduling logic:
 * 1. Pick an available sender
 * 2. Create campaign record
 * 3. Insert individual scheduled_email rows with computed times
 * 4. Enqueue BullMQ delayed jobs for each
 */
export async function scheduleEmails(
  input: ScheduleEmailInput,
  userId: string
): Promise<{ campaign: EmailCampaign; emailCount: number }> {
  // 1. Pick an enabled sender (round-robin via least recently used)
  const sender = await db.query.senders.findFirst({
    where: eq(senders.enabled, true),
    orderBy: senders.createdAt,
  });

  if (!sender) {
    throw new Error("No enabled senders available. Please configure a sender.");
  }

  const startTime = new Date(input.startTime);
  const now = new Date();

  // 2. Create the campaign
  const [campaign] = await db
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

  if (!campaign) {
    throw new Error("Failed to create campaign");
  }

  // 3. Compute individual scheduled times with delay offsets and hourly chunking
  const emailRows: {
    campaignId: string;
    senderId: string;
    recipient: string;
    scheduledTime: Date;
    status: string;
  }[] = [];

  for (let i = 0; i < input.recipients.length; i++) {
    const recipient = input.recipients[i]!;

    // Base offset from delay between emails
    const delayOffsetSeconds = i * input.delayBetweenEmails;

    // Additional offset for hourly chunking:
    // If hourlyLimit is 100 and we have 250 recipients,
    // emails 0-99 go in hour 0, 100-199 in hour 1, 200-249 in hour 2
    const hourChunk = Math.floor(i / input.hourlyLimit);
    const hourOffsetSeconds = hourChunk * 3600; // 3600 seconds = 1 hour

    // Position within the current hour chunk
    const posInChunk = i % input.hourlyLimit;
    const inChunkDelay = posInChunk * input.delayBetweenEmails;

    const scheduledTime = new Date(
      startTime.getTime() + (hourOffsetSeconds + inChunkDelay) * 1000
    );

    emailRows.push({
      campaignId: campaign.id,
      senderId: sender.id,
      recipient,
      scheduledTime,
      status: EMAIL_STATUS.SCHEDULED,
    });
  }

  // 4. Batch insert all scheduled emails
  const insertedEmails = await db
    .insert(scheduledEmails)
    .values(emailRows)
    .returning();

  // 5. Create BullMQ delayed jobs for each email
  for (const email of insertedEmails) {
    const delayMs = Math.max(0, email.scheduledTime.getTime() - now.getTime());

    await addEmailJob(
      {
        emailId: email.id,
        senderId: email.senderId,
        recipient: email.recipient,
        subject: input.subject,
        body: input.body,
      },
      delayMs
    );

    // Update bull_job_id reference
    await db
      .update(scheduledEmails)
      .set({ bullJobId: `email-${email.id}` })
      .where(eq(scheduledEmails.id, email.id));
  }

  // 6. Update campaign status
  await db
    .update(emailCampaigns)
    .set({ status: CAMPAIGN_STATUS.PROCESSING })
    .where(eq(emailCampaigns.id, campaign.id));

  return { campaign, emailCount: insertedEmails.length };
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
      const { emailQueue } = await import("../../queue/emailQueue.js");
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
