import type { Request, Response } from "express";
import {
  scheduleEmails,
  getScheduledEmails,
  getSentEmails,
  getCampaigns,
  deleteScheduledEmail,
} from "./email.service";
import { scheduleEmailSchema, parseEmailList } from "./email.validator.js";

/**
 * POST /api/emails/schedule
 * Schedule a batch of emails from a campaign.
 *
 * Body: { subject, body, recipients: string[], startTime, delayBetweenEmails?, hourlyLimit? }
 * Or with CSV: multipart form with csvFile + other fields.
 */
export async function scheduleEmailsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  // If recipients came as raw CSV text, parse them
  let { recipients, ...rest } = req.body;

  if (typeof recipients === "string") {
    recipients = parseEmailList(recipients);
  }

  const parsed = scheduleEmailSchema.safeParse({ ...rest, recipients });

  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await scheduleEmails(parsed.data, userId);

    res.status(201).json({
      message: `Successfully scheduled ${result.emailCount} emails`,
      campaign: {
        id: result.campaign.id,
        subject: result.campaign.subject,
        startTime: result.campaign.startTime,
        totalRecipients: result.campaign.totalRecipients,
      },
    });
  } catch (err) {
    console.error("Schedule error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to schedule emails",
    });
  }
}

/**
 * GET /api/emails/scheduled
 * List all pending/scheduled emails for the authenticated user.
 */
export async function getScheduledEmailsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  try {
    const emails = await getScheduledEmails(userId);
    res.json({ emails });
  } catch (err) {
    console.error("Get scheduled error:", err);
    res.status(500).json({ error: "Failed to fetch scheduled emails" });
  }
}

/**
 * GET /api/emails/sent
 * List all sent/failed emails for the authenticated user.
 */
export async function getSentEmailsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  try {
    const emails = await getSentEmails(userId);
    res.json({ emails });
  } catch (err) {
    console.error("Get sent error:", err);
    res.status(500).json({ error: "Failed to fetch sent emails" });
  }
}

/**
 * GET /api/campaigns
 * List all campaigns for the authenticated user with aggregated stats.
 */
export async function getCampaignsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  try {
    const campaigns = await getCampaigns(userId);
    res.json({ campaigns });
  } catch (err) {
    console.error("Get campaigns error:", err);
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
}

/**
 * DELETE /api/emails/:id
 * Delete a scheduled email that hasn't been sent yet.
 */
export async function deleteScheduledEmailHandler(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const emailId = req.params.id as string;

  if (!emailId) {
    res.status(400).json({ error: "Email ID is required" });
    return;
  }

  try {
    await deleteScheduledEmail(emailId, userId);
    res.json({ message: "Email deleted successfully" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete email";
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
}
