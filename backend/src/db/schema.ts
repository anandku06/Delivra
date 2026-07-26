import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Users ──────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleId: varchar("google_id", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  campaigns: many(emailCampaigns),
}));

// ─── Senders ────────────────────────────────────────────────────────────────────

export const senders = pgTable("senders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  smtpHost: varchar("smtp_host", { length: 255 }).notNull(),
  smtpPort: integer("smtp_port").notNull(),
  smtpUser: varchar("smtp_user", { length: 255 }).notNull(),
  smtpPass: text("smtp_pass").notNull(),
  dailyLimit: integer("daily_limit").notNull().default(500),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sendersRelations = relations(senders, ({ many }) => ({
  scheduledEmails: many(scheduledEmails),
}));

// ─── Email Campaigns ────────────────────────────────────────────────────────────

export const emailCampaigns = pgTable("email_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  delayBetweenEmails: integer("delay_between_emails").notNull(), // seconds
  hourlyLimit: integer("hourly_limit").notNull(),
  totalRecipients: integer("total_recipients").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("CREATED"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const emailCampaignsRelations = relations(
  emailCampaigns,
  ({ one, many }) => ({
    user: one(users, {
      fields: [emailCampaigns.userId],
      references: [users.id],
    }),
    scheduledEmails: many(scheduledEmails),
  })
);

// ─── Scheduled Emails ───────────────────────────────────────────────────────────

export const scheduledEmails = pgTable(
  "scheduled_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => senders.id),
    recipient: varchar("recipient", { length: 255 }).notNull(),
    scheduledTime: timestamp("scheduled_time", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("SCHEDULED"),
    bullJobId: varchar("bull_job_id", { length: 255 }),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_scheduled_emails_campaign").on(table.campaignId),
    index("idx_scheduled_emails_status").on(table.status),
    index("idx_scheduled_emails_time").on(table.scheduledTime),
    index("idx_scheduled_emails_sender_status").on(
      table.senderId,
      table.status
    ),
  ]
);

export const scheduledEmailsRelations = relations(
  scheduledEmails,
  ({ one }) => ({
    campaign: one(emailCampaigns, {
      fields: [scheduledEmails.campaignId],
      references: [emailCampaigns.id],
    }),
    sender: one(senders, {
      fields: [scheduledEmails.senderId],
      references: [senders.id],
    }),
  })
);

// ─── Types ──────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type NewEmailCampaign = typeof emailCampaigns.$inferInsert;
export type ScheduledEmail = typeof scheduledEmails.$inferSelect;
export type NewScheduledEmail = typeof scheduledEmails.$inferInsert;

export const EMAIL_STATUS = {
  SCHEDULED: "SCHEDULED",
  PROCESSING: "PROCESSING",
  SENT: "SENT",
  FAILED: "FAILED",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export const CAMPAIGN_STATUS = {
  CREATED: "CREATED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
} as const;
