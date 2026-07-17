import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const queueEnrichment = vi.fn();
const queueExport = vi.fn();
const phaseZeroDemoEnabled = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  queueEnrichment,
  queueExport,
}));
vi.mock("@/src/phase-zero", () => ({ phaseZeroDemoEnabled }));
vi.mock(
  "@/src/analysis/contracts",
  async () => import("../src/analysis/contracts.js"),
);

const idempotencyKey = "1f0e8e55-9bd6-46f1-a4c7-8690189cb9d7";
const viewState = {
  schemaVersion: 1,
  maxFbaOfferCount: 3,
  maxFbmOfferCount: 2,
  sort: "sourceRowNumber",
  direction: "asc",
  visibleGroups: ["identity"],
};

describe("analysis refresh and export routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phaseZeroDemoEnabled.mockReturnValue(true);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-current" });
  });

  it("queues a tenant-scoped active-view export with its complete typed state", async () => {
    queueExport.mockResolvedValue({
      id: "export-1",
      status: "PENDING",
      format: "CSV",
    });
    const { POST } =
      await import("../app/api/scans/[scanId]/analysis-exports/route.js");
    const response = await POST(
      new NextRequest(
        "http://localhost/api/scans/scan-current/analysis-exports",
        {
          method: "POST",
          body: JSON.stringify({
            format: "CSV",
            idempotencyKey,
            queryState: viewState,
          }),
        },
      ),
      { params: Promise.resolve({ scanId: "scan-current" }) },
    );

    expect(response.status).toBe(202);
    expect(queueExport).toHaveBeenCalledWith({
      organizationId: "org-current",
      kind: "ANALYSIS_VIEW",
      format: "CSV",
      scanJobId: "scan-current",
      queryState: viewState,
      idempotencyKey,
    });
    expect(await response.json()).toEqual({
      id: "export-1",
      status: "PENDING",
      format: "CSV",
    });
  });

  it("returns visible validation and unavailable states without leaking a tenant", async () => {
    const { POST } =
      await import("../app/api/scans/[scanId]/analysis-exports/route.js");
    const invalid = await POST(
      new NextRequest(
        "http://localhost/api/scans/scan-current/analysis-exports",
        {
          method: "POST",
          body: JSON.stringify({ format: "CSV" }),
        },
      ),
      { params: Promise.resolve({ scanId: "scan-current" }) },
    );
    expect(invalid.status).toBe(400);
    expect(queueExport).not.toHaveBeenCalled();

    phaseZeroDemoEnabled.mockReturnValue(false);
    const unauthorized = await POST(
      new NextRequest(
        "http://localhost/api/scans/other-tenant/analysis-exports",
        {
          method: "POST",
          body: JSON.stringify({
            format: "CSV",
            idempotencyKey,
            queryState: viewState,
          }),
        },
      ),
      { params: Promise.resolve({ scanId: "other-tenant" }) },
    );
    expect(unauthorized.status).toBe(404);
    expect(ensurePhaseZeroOrganization).not.toHaveBeenCalled();
  });

  it("preserves the persisted duplicate refresh response", async () => {
    queueEnrichment.mockResolvedValue({
      id: "enrichment-1",
      status: "PENDING",
      duplicate: true,
    });
    const { POST } = await import("../app/api/scans/[scanId]/refresh/route.js");
    const response = await POST(
      new NextRequest("http://localhost/api/scans/scan-current/refresh", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      }),
      { params: Promise.resolve({ scanId: "scan-current" }) },
    );

    expect(response.status).toBe(202);
    expect(queueEnrichment).toHaveBeenCalledWith(
      "org-current",
      "scan-current",
      idempotencyKey,
    );
    expect(await response.json()).toEqual({
      id: "enrichment-1",
      status: "PENDING",
      duplicate: true,
    });
  });
});
