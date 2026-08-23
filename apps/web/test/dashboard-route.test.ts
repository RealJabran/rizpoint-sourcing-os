import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const getDashboardScanSummary = vi.fn();
const getDashboardResearchSummary = vi.fn();
const organizationForRequest = vi.fn();
const requirePrivateAccess = vi.fn();

vi.mock("@rizpoint/database", () => ({
  getDashboardScanSummary,
  getDashboardResearchSummary,
}));
vi.mock("@/src/request-organization", () => ({ organizationForRequest }));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));

describe("dashboard summary route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the current organization dashboard summary", async () => {
    requirePrivateAccess.mockReturnValue(null);
    organizationForRequest.mockResolvedValue({ id: "org_current" });
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
    getDashboardResearchSummary.mockResolvedValue({
      activeProjects: 2,
      activeWatches: 4,
      openAlerts: 1,
      staleEvidence: 3,
      recentResearch: [],
      recentAlerts: [],
    });
    const { GET } = await import("../app/api/dashboard/summary/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/dashboard/summary"),
    );
    expect(response.status).toBe(200);
    expect(getDashboardScanSummary).toHaveBeenCalledWith("org_current");
    const body = await response.json();
    expect(body).toEqual({
      totalScans: 3,
      processingScans: 1,
      attentionScans: 1,
      activeProjects: 2,
      activeWatches: 4,
      openAlerts: 1,
      staleEvidence: 3,
      recentResearch: [],
      recentAlerts: [],
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

  it("does not expose a dashboard outside the authenticated organization boundary", async () => {
    requirePrivateAccess.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const { GET } = await import("../app/api/dashboard/summary/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/dashboard/summary"),
    );
    expect(response.status).toBe(403);
    expect(getDashboardScanSummary).not.toHaveBeenCalled();
  });
});
