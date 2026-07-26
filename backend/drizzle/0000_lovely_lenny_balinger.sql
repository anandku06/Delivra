CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"delay_between_emails" integer NOT NULL,
	"hourly_limit" integer NOT NULL,
	"total_recipients" integer NOT NULL,
	"status" varchar(20) DEFAULT 'CREATED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"scheduled_time" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'SCHEDULED' NOT NULL,
	"bull_job_id" varchar(255),
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"smtp_host" varchar(255) NOT NULL,
	"smtp_port" integer NOT NULL,
	"smtp_user" varchar(255) NOT NULL,
	"smtp_pass" text NOT NULL,
	"daily_limit" integer DEFAULT 500 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scheduled_emails_campaign" ON "scheduled_emails" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_emails_status" ON "scheduled_emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_scheduled_emails_time" ON "scheduled_emails" USING btree ("scheduled_time");--> statement-breakpoint
CREATE INDEX "idx_scheduled_emails_sender_status" ON "scheduled_emails" USING btree ("sender_id","status");