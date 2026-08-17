import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const listCategoryIntelligence = vi.fn();
const getCategoryIntelligence = vi.fn();
const requirePrivateAccess = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  listCategoryIntelligence,
  getCategoryIntelligence,
}));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));
vi.mock(
  "@/src/category-intelligence/contracts",
  async () => import("../src/category-intelligence/contracts.js"),
);

describe("Category Intelligence routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePrivateAccess.mockReturnValue(null);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-1" });
    listCategoryIntelligence.mockResolvedValue({ total: 0, rows: [] });
    getCategoryIntelligence.mockResolvedValue({ total: 0, products: [] });
  });

  it("passes the bounded marketplace filter to the tenant category browser", async () => {
    const { GET } = await import("../app/api/category-intelligence/route.js");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/category-intelligence?marketplaceId=ATVPDKIKX0DER&limit=50",
      ),
    );
    expect(response.status).toBe(200);
    expect(listCategoryIntelligence).toHaveBeenCalledWith({
      organizationId: "org-1",
      offset: 0,
      limit: 50,
      marketplaceId: "ATVPDKIKX0DER",
    });
  });

  it("does not load a category detail when private access is denied", async () => {
    requirePrivateAccess.mockReturnValue(new Response(null, { status: 401 }));
    const { GET } =
      await import("../app/api/category-intelligence/[categoryReference]/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/category-intelligence/Home"),
      { params: Promise.resolve({ categoryReference: "Home" }) },
    );
    expect(response.status).toBe(401);
    expect(getCategoryIntelligence).not.toHaveBeenCalled();
  });
});
