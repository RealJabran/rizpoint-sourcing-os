import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExportForOrganization: vi.fn(),
  createDownloadUrl: vi.fn(),
}));

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization: vi.fn().mockResolvedValue({ id: "org-1" }),
  getExportForOrganization: mocks.getExportForOrganization,
}));
vi.mock("@rizpoint/object-storage", () => ({
  createDownloadUrl: mocks.createDownloadUrl,
}));
vi.mock("@/src/private-access", () => ({
  requirePrivateAccess: vi.fn().mockReturnValue(null),
}));
vi.mock(
  "@/src/phase-six/export-download",
  async () => import("../src/phase-six/export-download.js"),
);

describe("private export download route", () => {
  beforeEach(() => {
    mocks.getExportForOrganization.mockReset();
    mocks.createDownloadUrl.mockReset();
  });

  it("returns an actionable expiry error instead of minting an old download", async () => {
    mocks.getExportForOrganization.mockResolvedValue({
      id: "export-1",
      status: "COMPLETED",
      objectKey: "exports/org-1/report.csv",
      filename: "report.csv",
      expiresAt: new Date("2026-07-14T23:59:59.999Z"),
    });
    const { GET } = await import("../app/api/exports/[exportId]/route.js");

    const response = await GET(
      new NextRequest("http://localhost/api/exports/export-1?download=1"),
      { params: Promise.resolve({ exportId: "export-1" }) },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "EXPORT_EXPIRED",
    });
    expect(mocks.createDownloadUrl).not.toHaveBeenCalled();
  });
});
