import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),

  FRONTEND_URL: z.string().url("FRONTEND_URL must be a valid URL"),

  // Redis
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL"),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),

  // JWT
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),

  // Ethereal SMTP (optional — auto-created if blank)
  ETHEREAL_USER: z.string().optional().default(""),
  ETHEREAL_PASS: z.string().optional().default(""),

  // Worker Configuration
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  DEFAULT_DELAY_SECONDS: z.coerce.number().int().min(0).default(2),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().min(1).default(200),

  // Server
  PORT: z.coerce.number().int().min(1).default(3001),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
