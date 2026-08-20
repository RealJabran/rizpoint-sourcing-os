import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const listProductExplorer = vi.fn();
const resolveProviderExportRights = vi.fn();
const requirePrivateAccess = vi.fn();
const enforceApiRateLimit = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  listProductExplorer,
  resolveProviderExportRights,
}));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));
vi.mock("@/src/api-rate-limit", () => ({ enforceApiRateLimit }));
vi.mock(
  "@/src/product-explorer/contracts",
  async () => import("../src/product-explorer/contracts.js"),
);

const row = {
  id: "product-1",
  asin: "B0SECRET001",
  title: "Provider title",
  brand: "Provider brand",
  marketplaceId: "ATVPDKIKX0DER",
  category: "Provider category",
  catalogProviderKey: "licensed-provider",
  sources: ["PROJECT"],
  price: "29.99",
  currency: "USD",
  rating: "4.5",
  reviewCount: "120",
  salesRank: "5000",
  offerCount: 3,
  fbaOfferCount: 2,
  fbmOfferCount: 1,
  amazonRetailPresence: "ABSENT",
  priceVolatilityPercent: "4.2",
  reviewGrowth: null,
  listingAgeDays: null,
  seasonalityStatus: null,
  historyStatus: "COMPLETE",
  historyCoveragePercent: "95",
  freshnessState: "FRESH",
  observedAt: "2026-08-19T00:00:00.000Z",
  pricingProviderKey: "licensed-provider",
  historyProviderKey: "licensed-provider",
};

describe("Product Explorer export licensing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePrivateAccess.mockReturnValue(null);
    enforceApiRateLimit.mockResolvedValue(null);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-1" });
    listProductExplorer.mockResolvedValue({ total: 1, rows: [row] });
  });

  it("redacts provider fields when redistribution rights are blocked", async () => {
    resolveProviderExportRights.mockImplementation(({ requests }) =>
      requests.map((request: Record<string, unknown>) => ({
        ...request,
        allowedFields: [],
        deniedFields: request.fields,
        decision: "BLOCKED",
      })),
    );
    const { GET } = await import("../app/api/product-explorer/export/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/product-explorer/export"),
    );
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(csv).not.toContain("B0SECRET001");
    expect(csv).not.toContain("Provider title");
    expect(csv).not.toContain("29.99");
    expect(csv).toContain("PROJECT");
    expect(csv).toContain("catalog:BLOCKED");
    expect(resolveProviderExportRights).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
    );
  });

  it("exports only fields named by a provider allowlist decision", async () => {
    resolveProviderExportRights.mockImplementation(({ requests }) =>
      requests.map(
        (request: { capability: string; fields: readonly string[] }) => {
          const allowedFields =
            request.capability === "CATALOG" ? ["catalog.asin"] : [];
          return {
            ...request,
            allowedFields,
            deniedFields: request.fields.filter(
              (field) => !allowedFields.includes(field),
            ),
            decision: allowedFields.length ? "PARTIALLY_ALLOWED" : "BLOCKED",
          };
        },
      ),
    );
    const { GET } = await import("../app/api/product-explorer/export/route.js");
    const csv = await (
      await GET(new NextRequest("http://localhost/api/product-explorer/export"))
    ).text();
    expect(csv).toContain("B0SECRET001");
    expect(csv).not.toContain("Provider title");
    expect(csv).not.toContain("29.99");
  });
});
