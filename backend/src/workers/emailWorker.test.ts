/**
 * emailWorker.test.ts
 *
 * Tests for email worker behavior — specifically the `failed` event handler
 * that updates the DB when a job exhausts all retry attempts, and the
 * processor clearing stale error state on each new attempt.
 *
 * All external dependencies (BullMQ Worker, DB, mailer, rate limiter) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const {
  mockDbUpdate,
  mockDbQueryFindFirst,
  capturedState,
} = vi.hoisted(() => {
  const mockDbUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
  const mockDbQueryFindFirst = vi.fn();
  const capturedState = {
    processor: null as ((job: unknown) => Promise<void>) | null,
    handlers: {} as Record<string, ((...args: unknown[]) => void)[]>,
  };
  return { mockDbUpdate, mockDbQueryFindFirst, capturedState };
});

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      scheduledEmails: { findFirst: mockDbQueryFindFirst },
      emailCampaigns: { findFirst: vi.fn().mockResolvedValue({ id: "camp-1", hourlyLimit: 10 }) },
      senders: { findFirst: vi.fn().mockResolvedValue({ id: "sender-1", name: "Test", smtpUser: "u@e.com" }) },
    },
    update: mockDbUpdate,
  },
}));

vi.mock("../queue/rateLimiter.js", () => ({
  tryConsume: vi.fn().mockResolvedValue({ allowed: true, current: 1, limit: 10, resetAt: new Date() }),
  getDelayUntilNextHour: vi.fn().mockReturnValue(3_600_000),
}));

vi.mock("../sender/mailer.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "msg-123", previewUrl: false }),
}));

vi.mock("../queue/emailQueue.js", () => ({
  EMAIL_QUEUE_NAME: "email-send",
  rescheduleEmailJob: vi.fn().mockResolvedValue("email-123"),
}));

vi.mock("../queue/connection.js", () => ({
  createRedisConnection: () => ({ on: vi.fn() }),
}));

vi.mock("../config/env.js", () => ({
  env: { WORKER_CONCURRENCY: 1, MAX_EMAILS_PER_HOUR: 10 },
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn(function (_name: string, processor: (job: unknown) => Promise<void>) {
    capturedState.processor = processor;
    return {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!capturedState.handlers[event]) capturedState.handlers[event] = [];
        capturedState.handlers[event].push(handler);
      }),
    };
  }),
}));

import { startEmailWorker } from "../workers/emailWorker.js";
import { db } from "../db/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<{
  id: string;
  attemptsMade: number;
  maxAttempts: number;
  emailId: string;
}> = {}) {
  const {
    id = "job-1",
    attemptsMade = 1,
    maxAttempts = 3,
    emailId = "email-uuid-123",
  } = overrides;

  return {
    id,
    attemptsMade,
    opts: { attempts: maxAttempts },
    data: {
      emailId,
      senderId: "sender-1",
      recipient: "test@example.com",
      subject: "Test",
      body: "Body",
    },
  };
}

function emitFailed(job: ReturnType<typeof makeJob>, err: Error) {
  const handlers = capturedState.handlers["failed"] ?? [];
  return Promise.all(handlers.map((h) => Promise.resolve(h(job, err))));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Email Worker — failed event handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedState.processor = null;
    for (const k of Object.keys(capturedState.handlers)) {
      capturedState.handlers[k] = [];
    }
    // Re-start the worker to register handlers fresh
    startEmailWorker();
  });

  it("updates DB to FAILED when all retry attempts are exhausted", async () => {
    const job = makeJob({ attemptsMade: 3, maxAttempts: 3 });
    const err = new Error("SMTP connection refused");

    await emitFailed(job, err);

    // Should have called db.update(scheduledEmails)
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);

    const setCall = mockDbUpdate.mock.results[0]?.value.set.mock.calls[0] as unknown[];
    const updatePayload = setCall?.[0] as Record<string, unknown>;
    expect(updatePayload.status).toBe("FAILED");
    expect(updatePayload.error).toContain("SMTP connection refused");
    expect(updatePayload.error).toContain("exhausted 3 attempts");
  });

  it("does NOT update DB to FAILED on a transient failure (retries remain)", async () => {
    // attemptsMade = 1, maxAttempts = 3 → still has 2 retries left
    const job = makeJob({ attemptsMade: 1, maxAttempts: 3 });
    const err = new Error("Temporary network error");

    await emitFailed(job, err);

    // DB should NOT be updated — the processor will retry and update itself
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("handles missing job gracefully (undefined job from stall with no data)", async () => {
    const handlers = capturedState.handlers["failed"] ?? [];
    // Emit with undefined job (can happen with stalled jobs in some BullMQ versions)
    await Promise.all(
      handlers.map((h) => Promise.resolve(h(undefined, new Error("stall"))))
    );

    // Should not throw or update DB
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

describe("Email Worker — processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedState.processor = null;
    for (const k of Object.keys(capturedState.handlers)) {
      capturedState.handlers[k] = [];
    }
    startEmailWorker();
  });

  it("skips processing if the email record is not found", async () => {
    mockDbQueryFindFirst.mockResolvedValueOnce(null);

    const job = makeJob();
    await capturedState.processor!(job);

    // Should not have tried to update status
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("skips processing if email is already SENT (idempotency)", async () => {
    mockDbQueryFindFirst.mockResolvedValueOnce({ id: "email-uuid-123", status: "SENT", campaignId: "camp-1", attempts: 1 });

    const job = makeJob();
    await capturedState.processor!(job);

    // No update
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("clears stale error when starting a new attempt (sets error: null in PROCESSING update)", async () => {
    // Email is in FAILED state from a previous attempt — should be retried
    mockDbQueryFindFirst.mockResolvedValueOnce({
      id: "email-uuid-123",
      status: "FAILED",
      campaignId: "camp-1",
      attempts: 1,
    });
    // Second findFirst is for campaign
    // Third is for sender
    // The checkCampaignCompletion call needs another findFirst

    const job = makeJob();
    await capturedState.processor!(job);

    // First update should be PROCESSING with error: null
    expect(mockDbUpdate).toHaveBeenCalled();
    const firstSet = mockDbUpdate.mock.results[0]?.value.set.mock.calls[0] as unknown[];
    const firstPayload = firstSet?.[0] as Record<string, unknown>;
    expect(firstPayload.status).toBe("PROCESSING");
    expect(firstPayload.error).toBeNull();
  });
});
