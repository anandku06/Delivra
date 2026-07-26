import { z } from "zod";

/**
 * Validates the schedule email request body.
 */
export const scheduleEmailSchema = z.object({
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(500, "Subject must be under 500 characters"),
  body: z
    .string()
    .min(1, "Email body is required"),
  recipients: z
    .array(z.string().email("Invalid email address"))
    .min(1, "At least one recipient is required"),
  startTime: z
    .string()
    .datetime("startTime must be a valid ISO datetime string")
    .refine(
      (val) => new Date(val).getTime() >= Date.now() - 30_000,
      "Start time cannot be in the past"
    ),
  delayBetweenEmails: z
    .number()
    .int()
    .min(0, "Delay must be >= 0 seconds")
    .default(2),
  hourlyLimit: z
    .number()
    .int()
    .min(1, "Hourly limit must be >= 1")
    .default(200),
});

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;

/**
 * Parse a CSV/text file content into an array of valid email addresses.
 * Handles comma-separated, newline-separated, or mixed formats.
 * Deduplicates and validates each entry.
 */
export function parseEmailList(rawContent: string): string[] {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const emails = rawContent
    // Split by commas, newlines, semicolons, or any whitespace
    .split(/[,;\n\r\t]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .filter((entry) => emailRegex.test(entry));

  // Deduplicate
  return [...new Set(emails)];
}
