import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";

let transporter: Transporter | null = null;

interface SendResult {
  messageId: string;
  previewUrl: string | false;
}

/**
 * Initialize the Nodemailer transport.
 *
 * If ETHEREAL_USER and ETHEREAL_PASS are provided, uses them.
 * Otherwise, auto-creates an Ethereal test account on first call.
 */
export async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  let user = env.ETHEREAL_USER;
  let pass = env.ETHEREAL_PASS;

  if (!user || !pass) {
    console.log("📧 No Ethereal credentials found. Creating test account...");
    const testAccount = await nodemailer.createTestAccount();
    user = testAccount.user;
    pass = testAccount.pass;
    console.log("📧 Ethereal test account created:");
    console.log(`   User: ${user}`);
    console.log(`   Pass: ${pass}`);
    console.log("   ⚠️  Add these to your .env to persist across restarts.");
  }

  transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  // Verify connection
  try {
    await transporter.verify();
    console.log("✅ Ethereal SMTP connection verified");
  } catch (err) {
    console.error("❌ Ethereal SMTP verification failed:", err);
    throw err;
  }

  return transporter;
}

/**
 * Send an email via the Ethereal SMTP transport.
 *
 * @returns The message ID and Ethereal preview URL.
 */
export async function sendEmail(params: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  const transport = await getTransporter();

  const info = await transport.sendMail({
    from: params.from,
    to: params.to,
    subject: params.subject,
    html: params.body,
    text: params.body.replace(/<[^>]*>/g, ""), // Strip HTML for text version
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);

  console.log(
    `📨 Email sent to ${params.to} | ID: ${info.messageId} | Preview: ${previewUrl}`
  );

  return {
    messageId: info.messageId,
    previewUrl,
  };
}
