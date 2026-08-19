import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const create = vi.fn();
const transaction = vi.fn(async (operation: (client: unknown) => unknown) =>
  operation({
    historyRefreshRun: { updateMany },
    outboxEvent: { create },
  }),
);

vi.mock("../src/client.js", () => ({
  db: { historyRefreshRun: { findMany }, $transaction: transaction },
}));

describe("history retry scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims due runs with a state predicate and emits an attempt-keyed job", async () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    findMany.mockResolvedValue([
      {
        id: "run-1",
        organizationId: "org-1",
        scanJobId: "scan-1",
        attemptCount: 2,
      },
    ]);
    updateMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue({ id: "event-1" });
    const { requeueDueHistoryRefreshRuns } =
      await import("../src/repositories/history-refresh.js");
    await expect(requeueDueHistoryRefreshRuns(now, 25)).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          status: "FAILED_RETRYABLE",
          retryAt: { lte: now },
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        eventType: "scan.history.retry.run-1.3",
        payload: expect.objectContaining({ runAttempt: 3 }),
      }),
    });
  });

  it("does not publish when another scheduler already claimed the run", async () => {
    findMany.mockResolvedValue([
      {
        id: "run-1",
        organizationId: "org-1",
        scanJobId: "scan-1",
        attemptCount: 2,
      },
    ]);
    updateMany.mockResolvedValue({ count: 0 });
    const { requeueDueHistoryRefreshRuns } =
      await import("../src/repositories/history-refresh.js");
    await expect(requeueDueHistoryRefreshRuns()).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
