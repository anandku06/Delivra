import type {
  AuthResponse,
  User,
  ScheduledEmail,
  SentEmail,
  Campaign,
  ScheduleEmailRequest,
  ScheduleEmailResponse,
} from "./types";

const API_BASE = "/api";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("delivra_token");
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ─── Auth ───────────────────────────────────────────────────────────────────────

export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
}

export async function getMe(): Promise<User> {
  return request<User>("/auth/me");
}

// ─── Emails ─────────────────────────────────────────────────────────────────────

export async function getScheduledEmails(): Promise<ScheduledEmail[]> {
  const res = await request<{ emails: ScheduledEmail[] }>("/emails/scheduled");
  return res.emails;
}

export async function getSentEmails(): Promise<SentEmail[]> {
  const res = await request<{ emails: SentEmail[] }>("/emails/sent");
  return res.emails;
}

export async function scheduleEmails(
  data: ScheduleEmailRequest
): Promise<ScheduleEmailResponse> {
  return request<ScheduleEmailResponse>("/emails/schedule", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteScheduledEmailApi(
  emailId: string
): Promise<{ message: string }> {
  return request<{ message: string }>(`/emails/${emailId}`, {
    method: "DELETE",
  });
}

// ─── Campaigns ──────────────────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  const res = await request<{ campaigns: Campaign[] }>("/campaigns");
  return res.campaigns;
}
