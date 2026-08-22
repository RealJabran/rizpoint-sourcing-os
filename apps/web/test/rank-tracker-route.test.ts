import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const listKeywordRankTracks = vi.fn();
const listProviderCapabilityStates = vi.fn();
const calculateKeywordRankAnalytics = vi.fn();
const requirePrivateAccess = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  listKeywordRankTracks,
  listProviderCapabilityStates,
  calculateKeywordRankAnalytics,
}));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));

describe("Rank Tracker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePrivateAccess.mockReturnValue(null);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-current" });
    listProviderCapabilityStates.mockResolvedValue([
      { capability: "SEARCH_RANK", state: "NOT_CONFIGURED" },
      { capability: "CATALOG", state: "HEALTHY" },
    ]);
    listKeywordRankTracks.mockResolvedValue({
      total: 1,
      offset: 0,
      limit: 100,
      rows: [
        {
          id: "track-1",
          keywordId: "keyword-1",
          marketplaceId: "ATVPDKIKX0DER",
          cadenceMinutes: 1440,
          nextRunAt: null,
          keyword: { id: "keyword-1", phrase: "synthetic keyword" },
          catalogProduct: {
            id: "product-1",
            asin: "B0ABC12345",
            title: "Synthetic product",
          },
          observations: [
            {
              providerKey: "licensed-fixture",
              observedAt: new Date("2026-08-21T00:00:00.000Z"),
              organicRank: 5,
              sponsoredRank: null,
              freshnessState: "FRESH",
            },
          ],
        },
      ],
    });
    calculateKeywordRankAnalytics.mockReturnValue({
      calculationVersion: "keyword-rank-analytics/v1",
      products: [
        {
          asin: "B0ABC12345",
          organic: { latest: 5 },
          sponsored: { latest: null },
          latestObservedAt: "2026-08-21T00:00:00.000Z",
          organicShareOfVoicePercent: "100.00",
        },
      ],
    });
  });

  it("returns persisted observations and only SEARCH_RANK capability state", async () => {
    const { GET } = await import("../app/api/rank-tracker/route.js");
    const response = await GET(
      new NextRequest("https://rizpoint.test/api/rank-tracker"),
    );
    const body = await response.json();
    expect(listKeywordRankTracks).toHaveBeenCalledWith({
      organizationId: "org-current",
      offset: 0,
      limit: 100,
    });
    expect(body.total).toBe(1);
    expect(body.universe).toContain("bounded organization window");
    expect(body.capabilityStates).toEqual([
      { capability: "SEARCH_RANK", state: "NOT_CONFIGURED" },
    ]);
    expect(body.groups[0]).toMatchObject({
      calculationVersion: "keyword-rank-analytics/v1",
      products: [
        {
          latestProvider: "licensed-fixture",
          latestFreshness: "FRESH",
          organicShareOfVoicePercent: "100.00",
        },
      ],
    });
  });
});
