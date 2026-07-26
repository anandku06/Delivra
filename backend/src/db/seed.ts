import "dotenv/config";
import nodemailer from "nodemailer";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { senders } from "./schema.js";

/**
 * Seed script — creates Ethereal test sender accounts in the DB.
 *
 * Usage: npm run seed
 */
async function seed() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL is required");
    process.exit(1);
  }

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  console.log("🌱 Seeding database...\n");

  // Create 2 Ethereal test accounts for multi-sender support
  const senderConfigs = [
    { name: "Delivra Sender 1" },
    { name: "Delivra Sender 2" },
  ];

  for (const config of senderConfigs) {
    console.log(`📧 Creating Ethereal account for "${config.name}"...`);

    const testAccount = await nodemailer.createTestAccount();

    const [created] = await db
      .insert(senders)
      .values({
        name: config.name,
        smtpHost: "smtp.ethereal.email",
        smtpPort: 587,
        smtpUser: testAccount.user,
        smtpPass: testAccount.pass,
        dailyLimit: 500,
        enabled: true,
      })
      .returning();

    console.log(`   ✅ Created sender: ${config.name}`);
    console.log(`      SMTP User: ${testAccount.user}`);
    console.log(`      SMTP Pass: ${testAccount.pass}`);
    console.log(`      DB ID: ${created!.id}\n`);
  }

  console.log("✅ Seeding complete!");

  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
