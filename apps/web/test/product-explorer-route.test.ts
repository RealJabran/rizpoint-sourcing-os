import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const listProductExplorer = vi.fn();
const requirePrivateAccess = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  listProductExplorer,
}));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));
vi.mock(
  "@/src/product-explorer/contracts",
  async () => import("../src/product-explorer/contracts.js"),
);

describe("Product Explorer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePrivateAccess.mockReturnValue(null);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-1" });
    listProductExplorer.mockResolvedValue({ total: 1, rows: [] });
  });

  it("passes only typed evidence filters to the tenant-scoped query", async () => {
    const { GET } = await import("../app/api/product-explorer/route.js");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/product-explorer?marketplaceId=ATVPDKIKX0DER&maxReviewCount=100&maxPriceVolatilityPercent=15&limit=50",
      ),
    );
    expect(response.status).toBe(200);
    expect(listProductExplorer).toHaveBeenCalledWith({
      organizationId: "org-1",
      offset: 0,
      limit: 50,
      filters: {
        marketplaceId: "ATVPDKIKX0DER",
        maxReviewCount: 100,
        maxPriceVolatilityPercent: "15",
      },
    });
  });

  it("does not read the explorer universe when private access is denied", async () => {
    const denied = new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
    });
    requirePrivateAccess.mockReturnValue(denied);
    const { GET } = await import("../app/api/product-explorer/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/product-explorer"),
    );
    expect(response.status).toBe(401);
    expect(listProductExplorer).not.toHaveBeenCalled();
  });
});
