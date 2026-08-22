import { afterEach, describe, expect, it, vi } from "vitest";

const recoverPublishedOutboxEvents = vi.fn();
const claimPendingOutboxEvents = vi.fn();
const markOutboxPublished = vi.fn();
const resetOutboxEvent = vi.fn();
const add = vi.fn();

vi.mock("@rizpoint/database", () => ({
  recoverPublishedOutboxEvents,
  claimPendingOutboxEvents,
  markOutboxPublished,
  resetOutboxEvent,
}));
vi.mock("../src/queue.js", () => ({ mockScanQueue: { add } }));
vi.mock("../src/observability.js", () => ({
  outboxPublished: { inc: vi.fn() },
  outboxReconciled: { inc: vi.fn() },
}));

describe("outbox dispatch recovery", () => {
  afterEach(() => vi.clearAllMocks());

  it("reconciles stale published events before claiming pending events", async () => {
    recoverPublishedOutboxEvents.mockResolvedValue(1);
    claimPendingOutboxEvents.mockResolvedValue([]);
    const { dispatchOutboxOnce } = await import("../src/dispatcher.js");
    await expect(dispatchOutboxOnce()).resolves.toBe(0);
    expect(recoverPublishedOutboxEvents).toHaveBeenCalledWith(25);
    expect(claimPendingOutboxEvents).toHaveBeenCalledWith(25);
  });

  it("uses a delayed queue job for a persisted provider retry deadline", async () => {
    recoverPublishedOutboxEvents.mockResolvedValue(0);
    claimPendingOutboxEvents.mockResolvedValue([
      {
        id: "outbox_1",
        claimToken: "claim_1",
        payload: {
          scanJobId: "scan_1",
          kind: "ENRICH",
          runAttempt: 2,
          notBefore: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    ]);
    add.mockResolvedValue({});
    markOutboxPublished.mockResolvedValue(true);
    const { dispatchOutboxOnce } = await import("../src/dispatcher.js");
    await expect(dispatchOutboxOnce()).resolves.toBe(1);
    expect(add).toHaveBeenCalledWith(
      "mock-scan",
      expect.any(Object),
      expect.objectContaining({
        delay: expect.any(Number),
        backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
      }),
    );
  });

  it("uses provider-aware backoff for Amazon connection jobs", async () => {
    recoverPublishedOutboxEvents.mockResolvedValue(0);
    claimPendingOutboxEvents.mockResolvedValue([
      {
        id: "outbox_provider",
        claimToken: "claim_provider",
        payload: {
          kind: "PROVIDER_CONNECTION",
          connectionJobId: "connection_job_1",
        },
      },
    ]);
    add.mockResolvedValue({});
    markOutboxPublished.mockResolvedValue(true);
    const { dispatchOutboxOnce } = await import("../src/dispatcher.js");
    await expect(dispatchOutboxOnce()).resolves.toBe(1);
    expect(add).toHaveBeenCalledWith(
      "mock-scan",
      expect.any(Object),
      expect.objectContaining({ backoff: { type: "provider" }, attempts: 3 }),
    );
  });
});
