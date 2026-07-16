import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const listAnalysisResults = vi.fn();
const phaseZeroDemoEnabled = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  listAnalysisResults,
}));
vi.mock("@/src/phase-zero", () => ({ phaseZeroDemoEnabled }));
vi.mock(
  "@/src/analysis/contracts",
  async () => import("../src/analysis/contracts.js"),
);

describe("analysis results route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phaseZeroDemoEnabled.mockReturnValue(true);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-1" });
  });

  it("passes typed offer filters through a tenant-scoped server query", async () => {
    listAnalysisResults.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: "result-1",
          offerIntelligence: {
            asin: "B000000001",
            marketplaceId: "ATVPDKIKX0DER",
            provider: "AMAZON_SP_API",
            operation: "getCompetitiveSummary",
            status: "PARTIAL",
            observedAt: "2026-07-18T12:00:00.000Z",
            expiresAt: "2026-07-18T12:15:00.000Z",
            freshnessState: "FRESH",
            requestHash: "request-hash",
            completeness: "PARTIAL",
            rawEvidenceReference: "private-reference",
            featuredOffer: {
              state: "PRESENT",
              price: "18.9900",
              currency: "USD",
              fulfillmentChannel: "AMAZON",
              sellerId: "authorized-seller-id",
            },
            amazonRetailPresence: "UNKNOWN",
            counts: {
              total: { value: 2, completeness: "PARTIAL" },
              fba: { value: 1, completeness: "PARTIAL" },
              fbm: { value: 1, completeness: "PARTIAL" },
            },
            lowestFbaPrice: "17.9900",
            lowestFbmPrice: "18.4900",
          },
        },
      ],
    });
    const { GET } = await import("../app/api/scans/[scanId]/results/route.js");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/scans/scan-1/results?featuredOfferState=PRESENT&amazonRetailPresence=UNKNOWN&pricingCompleteness=PARTIAL&minFbaOfferCount=1&maxFbmOfferCount=3",
      ),
      { params: Promise.resolve({ scanId: "scan-1" }) },
    );

    expect(response.status).toBe(200);
    expect(listAnalysisResults).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        scanJobId: "scan-1",
        filters: expect.objectContaining({
          featuredOfferState: "PRESENT",
          amazonRetailPresence: "UNKNOWN",
          pricingCompleteness: "PARTIAL",
          minFbaOfferCount: 1,
          maxFbmOfferCount: 3,
        }),
      }),
    );
    const body = await response.json();
    expect(body.rows[0].offerIntelligence.featuredOffer.price).toBe("18.9900");
    expect(JSON.stringify(body)).not.toContain("rawProviderObservation");
  });

  it("does not query another tenant when the local authorization boundary is disabled", async () => {
    phaseZeroDemoEnabled.mockReturnValue(false);
    const { GET } = await import("../app/api/scans/[scanId]/results/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/scans/scan-1/results"),
      { params: Promise.resolve({ scanId: "scan-1" }) },
    );
    expect(response.status).toBe(404);
    expect(ensurePhaseZeroOrganization).not.toHaveBeenCalled();
    expect(listAnalysisResults).not.toHaveBeenCalled();
  });
});
