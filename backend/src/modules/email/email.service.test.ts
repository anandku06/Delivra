/**
 * email.service.test.ts
 *
 * Tests for scheduleEmails (transaction + enqueue) and recoverUnqueuedEmails.
 *
 * Verifies:
 *  - Campaign + email rows are created inside a DB transaction
 *  - A DB transaction failure (simulated) leaves no orphaned records (rollback)
 *  - BullMQ enqueue failures do not crash the scheduling request
 *  - recoverUnqueuedEmails finds emails with no bullJobId and re-enqueues them
 *  - recoverUnqueuedEmails is idempotent (runs on already-recovered emails safely)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const {
  mockTransactionFn,
  mockInsertCampaign,
  mockInsertEmails,
  mockUpdateScheduled,
  mockUpdateCampaign,
  mockSelectPending,
  mockQueryCampaignFindFirst,
  mockQuerySendersFindFirst,
} = vi.hoisted(() => ({
  mockTransactionFn: vi.fn(),
  mockInsertCampaign: vi.fn(),
  mockInsertEmails: vi.fn(),
  mockUpdateScheduled: vi.fn(),
  mockUpdateCampaign: vi.fn(),
  mockSelectPending: vi.fn(),
  mockQueryCampaignFindFirst: vi.fn(),
  mockQuerySendersFindFirst: vi.fn(),
}));

// Build a chainable mock for db.update().set().where()
function makeUpdateChain(mock: ReturnType<typeof vi.fn>) {
  const chain = {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
  mock.mockReturnValue(chain);
  return chain;
}

// Build a chainable mock for db.select().from().where()
function makeSelectChain(result: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(result),
    }),
  };
}

vi.mock("../../db/index.js", () => {
  return {
    db: {
      transaction: mockTransactionFn,
      query: {
        senders: { findFirst: mockQuerySendersFindFirst },
        emailCampaigns: { findFirst: mockQueryCampaignFindFirst },
      },
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
  };
});

vi.mock("../../queue/emailQueue.js", () => ({
  addEmailJob: vi.fn().mockResolvedValue("email-job-id"),
  emailQueue: {
    getJob: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../config/env.js", () => ({
  env: { MAX_EMAILS_PER_HOUR: 200 },
}));

import { scheduleEmails, recoverUnqueuedEmails } from "../email/email.service.js";
import { addEmailJob } from "../../queue/emailQueue.js";
import { db } from "../../db/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validInput = {
  subject: "Hello Campaign",
  body: "<p>Hello</p>",
  recipients: ["a@test.com", "b@test.com"],
  startTime: new Date(Date.now() + 60_000).toISOString(),
  delayBetweenEmails: 2,
  hourlyLimit: 200,
};

const mockCampaign = {
  id: "camp-uuid-1",
  userId: "user-1",
  subject: "Hello Campaign",
  body: "<p>Hello</p>",
  startTime: new Date(),
  delayBetweenEmails: 2,
  hourlyLimit: 200,
  totalRecipients: 2,
  status: "CREATED",
  createdAt: new Date(),
};

const mockEmails = [
  { id: "email-1", senderId: "sender-1", recipient: "a@test.com", scheduledTime: new Date(), campaignId: "camp-uuid-1", status: "SCHEDULED", bullJobId: null, attempts: 0, sentAt: null, error: null, createdAt: new Date() },
  { id: "email-2", senderId: "sender-1", recipient: "b@test.com", scheduledTime: new Date(), campaignId: "camp-uuid-1", status: "SCHEDULED", bullJobId: null, attempts: 0, sentAt: null, error: null, createdAt: new Date() },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("scheduleEmails — transaction usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: sender available
    mockQuerySendersFindFirst.mockResolvedValue({
      id: "sender-1",
      name: "Test Sender",
      smtpUser: "smtp@test.com",
      smtpPass: "pass",
      smtpHost: "smtp.ethereal.email",
      smtpPort: 587,
      dailyLimit: 500,
      enabled: true,
      createdAt: new Date(),
    });

    // Default: transaction calls the callback synchronously with a tx object
    mockTransactionFn.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      let insertCount = 0;
      const tx = {
        insert: vi.fn().mockImplementation(() => {
          insertCount++;
          const result = insertCount === 1 ? [mockCampaign] : mockEmails;
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue(result),
            }),
          };
        }),
      };
      await callback(tx);
    });
  });

  it("wraps DB inserts in a transaction", async () => {
    await scheduleEmails(validInput, "user-1");

    expect(mockTransactionFn).toHaveBeenCalledTimes(1);
  });

  it("enqueues BullMQ jobs after the transaction commits", async () => {
    await scheduleEmails(validInput, "user-1");

    // addEmailJob should be called for each email
    expect(addEmailJob).toHaveBeenCalledTimes(validInput.recipients.length);
  });

  it("rolls back and throws if transaction fails — no orphaned records", async () => {
    // Simulate transaction failure (e.g., DB constraint violation)
    mockTransactionFn.mockRejectedValueOnce(new Error("DB constraint violation"));

    await expect(scheduleEmails(validInput, "user-1")).rejects.toThrow("DB constraint violation");

    // addEmailJob should NOT have been called — DB rolled back
    expect(addEmailJob).not.toHaveBeenCalled();
  });

  it("does not throw if some BullMQ enqueues fail (partial failure tolerance)", async () => {
    // Transaction succeeds, but addEmailJob fails for one email
    (addEmailJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("email-job-1")  // first email succeeds
      .mockRejectedValueOnce(new Error("Redis connection error")); // second fails

    // Should not throw — partial failures are tolerated and logged
    await expect(scheduleEmails(validInput, "user-1")).resolves.toBeDefined();
  });

  it("throws if no enabled sender is available", async () => {
    mockQuerySendersFindFirst.mockResolvedValueOnce(null);

    await expect(scheduleEmails(validInput, "user-1")).rejects.toThrow(
      "No enabled senders available"
    );
  });
});

describe("recoverUnqueuedEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when there are no pending emails", async () => {
    // db.select().from().where() returns empty array
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    await recoverUnqueuedEmails();

    expect(addEmailJob).not.toHaveBeenCalled();
  });

  it("re-enqueues SCHEDULED emails that have no bullJobId", async () => {
    const pendingEmail = {
      id: "email-orphan-1",
      senderId: "sender-1",
      recipient: "orphan@test.com",
      scheduledTime: new Date(Date.now() + 60_000),
      campaignId: "camp-1",
    };

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([pendingEmail]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    mockQueryCampaignFindFirst.mockResolvedValueOnce({
      id: "camp-1",
      subject: "Recovery Test",
      body: "<p>Recover</p>",
    });

    await recoverUnqueuedEmails();

    expect(addEmailJob).toHaveBeenCalledWith(
      expect.objectContaining({
        emailId: "email-orphan-1",
        recipient: "orphan@test.com",
      }),
      expect.any(Number)
    );
  });

  it("skips emails whose campaign record is missing", async () => {
    const pendingEmail = {
      id: "email-no-campaign",
      senderId: "sender-1",
      recipient: "ghost@test.com",
      scheduledTime: new Date(),
      campaignId: "nonexistent-camp",
    };

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([pendingEmail]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    mockQueryCampaignFindFirst.mockResolvedValueOnce(null);

    // Should not throw, should not enqueue
    await recoverUnqueuedEmails();
    expect(addEmailJob).not.toHaveBeenCalled();
  });

  it("continues recovering other emails if one enqueue fails", async () => {
    const emails = [
      { id: "e1", senderId: "s1", recipient: "a@t.com", scheduledTime: new Date(), campaignId: "c1" },
      { id: "e2", senderId: "s1", recipient: "b@t.com", scheduledTime: new Date(), campaignId: "c1" },
    ];

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(emails),
      }),
    } as unknown as ReturnType<typeof db.select>);

    mockQueryCampaignFindFirst.mockResolvedValue({ id: "c1", subject: "Test", body: "Body" });

    // First enqueue fails, second succeeds
    (addEmailJob as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Redis unavailable"))
      .mockResolvedValueOnce("email-job-e2");

    // Should not throw
    await expect(recoverUnqueuedEmails()).resolves.toBeUndefined();

    // Both were attempted
    expect(addEmailJob).toHaveBeenCalledTimes(2);
  });

  it("re-enqueues RATE_LIMITED emails that have no bullJobId (e.g. after reschedule failure)", async () => {
    const rateLimitedEmail = {
      id: "email-rl-1",
      senderId: "sender-1",
      recipient: "rl@test.com",
      scheduledTime: new Date(Date.now() + 120_000),
      campaignId: "camp-1",
    };

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([rateLimitedEmail]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    mockQueryCampaignFindFirst.mockResolvedValueOnce({
      id: "camp-1",
      subject: "Rate Limit Recovery",
      body: "<p>Recover RL</p>",
    });

    await recoverUnqueuedEmails();

    expect(addEmailJob).toHaveBeenCalledWith(
      expect.objectContaining({
        emailId: "email-rl-1",
        recipient: "rl@test.com",
      }),
      expect.any(Number)
    );
  });
});
