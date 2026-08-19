import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const queueHistoryRefresh = vi.fn();
const phaseZeroDemoEnabled = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  queueHistoryRefresh,
}));
vi.mock("@/src/phase-zero", () => ({ phaseZeroDemoEnabled }));

describe("history refresh background boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phaseZeroDemoEnabled.mockReturnValue(true);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-1" });
    queueHistoryRefresh.mockResolvedValue({
      id: "run-1",
      status: "PENDING",
      duplicate: false,
      items: [{ id: "item-1" }],
    });
  });

  it("returns 202 after durable enqueue instead of waiting for a provider", async () => {
    const { POST } =
      await import("../app/api/scans/[scanId]/history-refresh/route.js");
    const response = await POST(
      new NextRequest("http://localhost/api/scans/scan-1/history-refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: "00000000-0000-4000-8000-000000000001",
          asins: ["B000000001"],
        }),
      }),
      { params: Promise.resolve({ scanId: "scan-1" }) },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      id: "run-1",
      status: "PENDING",
      duplicate: false,
      itemCount: 1,
    });
    expect(queueHistoryRefresh).toHaveBeenCalledOnce();
  });
});
