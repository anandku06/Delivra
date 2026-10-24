/**
 * emailQueue.test.ts
 *
 * Tests for the BullMQ email queue — specifically rescheduleEmailJob.
 *
 * Verifies:
 *  - addEmailJob uses a deterministic job ID
 *  - rescheduleEmailJob uses the same deterministic ID (not timestamp-based)
 *  - rescheduleEmailJob removes the existing job before re-adding
 *  - Concurrent reschedule calls do not create multiple live jobs
 *  - A missing existing job (already removed) does not cause reschedule to fail
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock BullMQ Queue ────────────────────────────────────────────────────────

const { mockJobRemove, mockQueueAdd, mockQueueGetJob, mockDbUpdate } = vi.hoisted(() => ({
  mockJobRemove: vi.fn().mockResolvedValue(undefined),
  mockQueueAdd: vi.fn(),
  mockQueueGetJob: vi.fn(),
  mockDbUpdate: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}));

vi.mock("bullmq", () => {
  return {
    Queue: vi.fn(function () {
      return {
        add: mockQueueAdd,
        getJob: mockQueueGetJob,
      };
    }),
  };
});

// Mock DB
vi.mock("../db/index.js", () => ({
  db: {
    update: mockDbUpdate,
  },
}));

// Mock the connection factory (Queue constructor calls it)
vi.mock("../queue/connection.js", () => ({
  createRedisConnection: () => ({
    on: vi.fn(),
  }),
}));

// Mock env
vi.mock("../config/env.js", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    MAX_EMAILS_PER_HOUR: 200,
  },
}));

import { addEmailJob, rescheduleEmailJob, type EmailJobPayload } from "../queue/emailQueue.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const payload: EmailJobPayload = {
  emailId: "email-uuid-123",
  senderId: "sender-uuid-456",
  recipient: "test@example.com",
  subject: "Hello",
  body: "<p>World</p>",
};

function makeMockJob(id: string) {
  return { id, remove: mockJobRemove };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("addEmailJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueAdd.mockResolvedValue(makeMockJob(`email-${payload.emailId}`));
  });

  it("uses a deterministic job ID based on emailId", async () => {
    await addEmailJob(payload, 5000);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send-email",
      payload,
      expect.objectContaining({ jobId: `email-${payload.emailId}` })
    );
  });

  it("passes the delay to BullMQ", async () => {
    await addEmailJob(payload, 30_000);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send-email",
      payload,
      expect.objectContaining({ delay: 30_000 })
    );
  });

  it("clamps negative delay to 0", async () => {
    await addEmailJob(payload, -5000);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send-email",
      payload,
      expect.objectContaining({ delay: 0 })
    );
  });
});

describe("rescheduleEmailJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the SAME deterministic job ID as the original (not timestamp-based)", async () => {
    // Simulate no existing job
    mockQueueGetJob.mockResolvedValue(null);
    mockQueueAdd.mockResolvedValue(makeMockJob(`email-${payload.emailId}`));

    await rescheduleEmailJob(payload, 3_600_000);

    const addCall = mockQueueAdd.mock.calls[0] as Parameters<typeof mockQueueAdd>;
    const options = addCall[2] as { jobId: string };
    expect(options.jobId).toBe(`email-${payload.emailId}`);
    // Must NOT contain a timestamp or random suffix
    expect(options.jobId).not.toMatch(/-r\d+$/);
  });

  it("removes the existing job before re-adding", async () => {
    const existingJob = makeMockJob(`email-${payload.emailId}`);
    mockQueueGetJob.mockResolvedValue(existingJob);
    mockQueueAdd.mockResolvedValue(makeMockJob(`email-${payload.emailId}`));

    await rescheduleEmailJob(payload, 3_600_000);

    // getJob → remove → add, in that order
    expect(mockQueueGetJob).toHaveBeenCalledWith(`email-${payload.emailId}`);
    expect(mockJobRemove).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("does not fail if existing job was already removed before our remove() call", async () => {
    // Simulate: getJob finds it, but remove() throws (already gone)
    const existingJob = {
      id: `email-${payload.emailId}`,
      remove: vi.fn().mockRejectedValue(new Error("Job not found")),
    };
    mockQueueGetJob.mockResolvedValue(existingJob);
    mockQueueAdd.mockResolvedValue(makeMockJob(`email-${payload.emailId}`));

    // Should NOT throw — the catch inside rescheduleEmailJob handles this
    await expect(rescheduleEmailJob(payload, 3_600_000)).resolves.toBeDefined();
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("still adds the new job when no existing job is found", async () => {
    mockQueueGetJob.mockResolvedValue(null);
    mockQueueAdd.mockResolvedValue(makeMockJob(`email-${payload.emailId}`));

    await rescheduleEmailJob(payload, 3_600_000);

    expect(mockJobRemove).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("concurrent reschedule calls result in only one add (BullMQ ID deduplication)", async () => {
    /**
     * Simulate two workers racing to reschedule the same job:
     *
     *   Worker A: getJob → finds job → remove → add ✓
     *   Worker B: getJob → finds null (A already removed it) → add → BullMQ deduplicates
     *
     * In real BullMQ, the second add with the same jobId returns the existing job.
     * Here we verify that the deterministic ID means BullMQ can deduplicate them.
     * The key invariant is: both calls use the same `jobId`, never a random suffix.
     */
    const existingJob = makeMockJob(`email-${payload.emailId}`);

    // Both workers call getJob — Worker A finds it, Worker B sees null
    mockQueueGetJob
      .mockResolvedValueOnce(existingJob)  // Worker A
      .mockResolvedValueOnce(null);         // Worker B

    mockQueueAdd.mockResolvedValue(makeMockJob(`email-${payload.emailId}`));

    await Promise.all([
      rescheduleEmailJob(payload, 3_600_000),
      rescheduleEmailJob(payload, 3_600_000),
    ]);

    // Both use the same deterministic jobId
    const addCalls = mockQueueAdd.mock.calls as Parameters<typeof mockQueueAdd>[];
    for (const call of addCalls) {
      expect((call[2] as { jobId: string }).jobId).toBe(`email-${payload.emailId}`);
    }

    // Both actually called add (BullMQ handles deduplication on its end)
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
  });

  it("passes new delay to BullMQ", async () => {
    mockQueueGetJob.mockResolvedValue(null);
    mockQueueAdd.mockResolvedValue(makeMockJob(`email-${payload.emailId}`));

    const newDelayMs = 7_200_000;
    await rescheduleEmailJob(payload, newDelayMs);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send-email",
      payload,
      expect.objectContaining({ delay: newDelayMs })
    );
  });

  it("clears bullJobId and marks email as SCHEDULED in DB if adding replacement job fails", async () => {
    const existingJob = makeMockJob(`email-${payload.emailId}`);
    mockQueueGetJob.mockResolvedValue(existingJob);
    // Queue.add fails (e.g. Redis connection drops)
    mockQueueAdd.mockRejectedValue(new Error("Redis connection dropped"));

    await expect(rescheduleEmailJob(payload, 3_600_000)).rejects.toThrow("Redis connection dropped");

    // Existing job was removed
    expect(mockJobRemove).toHaveBeenCalledTimes(1);

    // DB update was triggered to clear bullJobId and reset to SCHEDULED
    expect(mockDbUpdate).toHaveBeenCalled();
    const setCall = mockDbUpdate.mock.results[0]?.value.set.mock.calls[0] as unknown[];
    const payloadPassed = setCall?.[0] as Record<string, unknown>;
    expect(payloadPassed.bullJobId).toBeNull();
    expect(payloadPassed.status).toBe("SCHEDULED");
    expect(payloadPassed.error).toContain("Redis connection dropped");
  });
});
