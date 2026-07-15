import { afterEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const getDashboardScanSummary = vi.fn();
const phaseZeroDemoEnabled = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  getDashboardScanSummary,
}));
vi.mock("@/src/phase-zero", () => ({ phaseZeroDemoEnabled }));

describe("dashboard summary route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the current organization dashboard summary", async () => {
    phaseZeroDemoEnabled.mockReturnValue(true);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org_current" });
    getDashboardScanSummary.mockResolvedValue({
      totalScans: 3,
      processingScans: 1,
      attentionScans: 1,
      recentScans: [
        {
          id: "scan_1",
          organizationId: "org_current",
          idempotencyKey: "internal-key",
          jobType: "UPLOAD",
          status: "COMPLETED",
          attemptCount: 0,
          createdAt: new Date("2026-07-15T08:00:00.000Z"),
          updatedAt: new Date("2026-07-15T08:01:00.000Z"),
          completedAt: new Date("2026-07-15T08:01:00.000Z"),
          supplier: { code: "VSI", name: "VSI" },
          upload: {
            originalFilename: "catalog.csv",
            status: "COMPLETED",
            malwareStatus: "CLEAN",
          },
          _count: { supplierRows: 2 },
        },
      ],
    });
    const { GET } = await import("../app/api/dashboard/summary/route.js");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(getDashboardScanSummary).toHaveBeenCalledWith("org_current");
    const body = await response.json();
    expect(body).toEqual({
      totalScans: 3,
      processingScans: 1,
      attentionScans: 1,
      recentScans: [
        expect.objectContaining({
          id: "scan_1",
          createdAt: "2026-07-15T08:00:00.000Z",
        }),
      ],
    });
    expect(body).not.toHaveProperty("recentScans.0.organizationId");
    expect(body).not.toHaveProperty("recentScans.0.idempotencyKey");
  });

  it("does not expose a dashboard when the local/private boundary is disabled", async () => {
    phaseZeroDemoEnabled.mockReturnValue(false);
    const { GET } = await import("../app/api/dashboard/summary/route.js");
    const response = await GET();
    expect(response.status).toBe(404);
    expect(getDashboardScanSummary).not.toHaveBeenCalled();
  });
});
