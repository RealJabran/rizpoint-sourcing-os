import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const findMany = vi.fn();
const transaction = vi.fn();

vi.mock("../src/client.js", () => ({
  db: {
    $transaction: transaction,
    productWatch: { count, findMany },
  },
}));

describe("product tracker repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    count.mockReturnValue("count-query");
    findMany.mockReturnValue("rows-query");
    transaction.mockResolvedValue([
      1,
      [
        {
          id: "watch-1",
          status: "ACTIVE",
          marketplaceId: "ATVPDKIKX0DER",
          cadenceMinutes: 1440,
          nextObservationAt: null,
          lastObservedAt: new Date("2026-08-21T00:00:00.000Z"),
          project: { id: "project-1", name: "Project one" },
          catalogProduct: {
            id: "product-1",
            asin: "B0ABC12345",
            title: "Synthetic product",
            brand: "Fixture",
            provider: "recorded-history",
            observedAt: new Date("2026-08-20T00:00:00.000Z"),
            freshnessState: "FRESH",
            salesEstimates: [
              {
                marketplaceId: "ATVPDKIKX0DER",
                monthlyUnitsLow: { toString: () => "90.0000" },
                monthlyUnitsHigh: { toString: () => "110.0000" },
                confidencePercent: { toString: () => "80.0000" },
                source: "PROVIDER",
                providerKey: "licensed-fixture",
                modelVersion: "fixture/v1",
                observedAt: new Date("2026-08-20T00:00:00.000Z"),
              },
            ],
            historyAnalyticsAssessments: [],
          },
        },
      ],
    ]);
  });

  it("uses a bounded tenant and marketplace window and preserves provenance", async () => {
    const { listProductTracker } =
      await import("../src/repositories/product-tracker.js");
    const result = await listProductTracker({
      organizationId: "org-current",
      marketplaceId: "ATVPDKIKX0DER",
      offset: -10,
      limit: 500,
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        organizationId: "org-current",
        marketplaceId: "ATVPDKIKX0DER",
      },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 100,
        where: {
          organizationId: "org-current",
          marketplaceId: "ATVPDKIKX0DER",
        },
      }),
    );
    expect(result.rows[0]).toMatchObject({
      product: {
        source: "recorded-history",
        observedAt: "2026-08-20T00:00:00.000Z",
      },
      demandEstimate: {
        monthlyUnitsLow: "90.0000",
        monthlyUnitsHigh: "110.0000",
        providerKey: "licensed-fixture",
        modelVersion: "fixture/v1",
      },
    });
    expect(result.universe).toContain("not a global Amazon");
  });

  it("does not mix demand observations from another marketplace", async () => {
    transaction.mockResolvedValueOnce([
      1,
      [
        {
          id: "watch-1",
          status: "ACTIVE",
          marketplaceId: "ATVPDKIKX0DER",
          cadenceMinutes: 1440,
          nextObservationAt: null,
          lastObservedAt: null,
          project: null,
          catalogProduct: {
            id: "product-1",
            asin: "B0ABC12345",
            title: "Synthetic product",
            brand: "Fixture",
            provider: "recorded-history",
            observedAt: new Date("2026-08-20T00:00:00.000Z"),
            freshnessState: "FRESH",
            salesEstimates: [
              {
                marketplaceId: "A1F83G8C2ARO7P",
                monthlyUnitsLow: { toString: () => "900.0000" },
                monthlyUnitsHigh: { toString: () => "1100.0000" },
                confidencePercent: null,
                source: "PROVIDER",
                providerKey: "licensed-fixture",
                modelVersion: "fixture/v1",
                observedAt: new Date("2026-08-20T00:00:00.000Z"),
              },
            ],
            historyAnalyticsAssessments: [],
          },
        },
      ],
    ]);
    const { listProductTracker } =
      await import("../src/repositories/product-tracker.js");

    const result = await listProductTracker({ organizationId: "org-current" });

    expect(result.rows[0]?.demandEstimate).toBeNull();
  });
});
