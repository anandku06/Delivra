// ─── User ──────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ─── Email ─────────────────────────────────────────────────────────────────────

export type EmailStatus =
  | "SCHEDULED"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "RATE_LIMITED";

export interface ScheduledEmail {
  id: string;
  recipient: string;
  subject: string;
  scheduledTime: string;
  status: EmailStatus;
  campaignId: string;
}

export interface SentEmail {
  id: string;
  recipient: string;
  subject: string;
  sentAt: string | null;
  status: "SENT" | "FAILED";
  error: string | null;
  campaignId: string;
}

// ─── Campaign ──────────────────────────────────────────────────────────────────

export interface Campaign {
  id: string;
  subject: string;
  startTime: string;
  totalRecipients: number;
  status: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
  createdAt: string;
  sentCount: number;
  failedCount: number;
}

// ─── Schedule Request ──────────────────────────────────────────────────────────

export interface ScheduleEmailRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
}

export interface ScheduleEmailResponse {
  message: string;
  campaign: {
    id: string;
    subject: string;
    startTime: string;
    totalRecipients: number;
  };
}

// ─── API Responses ─────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
}
