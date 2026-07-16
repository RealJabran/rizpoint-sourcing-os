import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";

const mocks = vi.hoisted(() => ({
  completeEnrichmentRun: vi.fn(),
  getEnrichmentRunForProcessing: vi.fn(),
  persistEnrichmentItem: vi.fn(),
  recordProviderCallAttempt: vi.fn(),
  scheduleEnrichmentRetry: vi.fn(),
  createEnrichmentProvider: vi.fn(),
  providerCallsInc: vi.fn(),
}));

vi.mock("@rizpoint/database", () => ({
  completeEnrichmentRun: mocks.completeEnrichmentRun,
  getEnrichmentRunForProcessing: mocks.getEnrichmentRunForProcessing,
  persistEnrichmentItem: mocks.persistEnrichmentItem,
  recordProviderCallAttempt: mocks.recordProviderCallAttempt,
  scheduleEnrichmentRetry: mocks.scheduleEnrichmentRetry,
}));
vi.mock("../src/enrichment-provider.js", () => ({
  createEnrichmentProvider: mocks.createEnrichmentProvider,
}));
vi.mock("../src/observability.js", () => ({
  providerCalls: { inc: mocks.providerCallsInc },
}));

describe("enrichment provider setup failures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists explicit partial data instead of failing the job before item recovery", async () => {
    mocks.getEnrichmentRunForProcessing.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      attemptCount: 1,
      providerConnection: {
        provider: "AMAZON_SP_API",
        marketplaceId: "ATVPDKIKX0DER",
      },
      items: [{ id: "item-1", asin: "B000000001", status: "PENDING" }],
    });
    mocks.createEnrichmentProvider.mockImplementation(() => {
      throw new ProviderError("UNAUTHORIZED");
    });
    const { processEnrichment } = await import("../src/enrichment.js");

    await expect(processEnrichment("scan-1")).resolves.toBeUndefined();

    expect(mocks.recordProviderCallAttempt).toHaveBeenCalledTimes(5);
    expect(mocks.persistEnrichmentItem).toHaveBeenCalledWith({
      enrichmentItemId: "item-1",
      observations: [
        expect.objectContaining({
          metricType: "PRICING",
          operation: "getCompetitiveSummary",
          observationStatus: "UNAUTHORIZED",
          featuredOfferState: "UNKNOWN",
          amazonRetailPresence: "UNKNOWN",
          visibleOfferCountCompleteness: "UNKNOWN",
          fbaOfferCountCompleteness: "UNKNOWN",
          fbmOfferCountCompleteness: "UNKNOWN",
        }),
      ],
      missingMetrics: [
        "CATALOG_UNAUTHORIZED",
        "PRICING_UNAUTHORIZED",
        "FEES_UNAUTHORIZED",
        "RESTRICTIONS_UNAUTHORIZED",
        "HISTORY_UNAUTHORIZED",
      ],
      errorCode: "UNAUTHORIZED",
    });
    expect(mocks.completeEnrichmentRun).toHaveBeenCalledWith("run-1");
  });
});
