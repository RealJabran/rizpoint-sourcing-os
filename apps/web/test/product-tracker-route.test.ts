import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const listProductTracker = vi.fn();
const requirePrivateAccess = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  listProductTracker,
}));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));

describe("Product Tracker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePrivateAccess.mockReturnValue(null);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-current" });
    listProductTracker.mockResolvedValue({ total: 0, rows: [] });
  });

  it("keeps marketplace filtering tenant-scoped and bounded", async () => {
    const { GET } = await import("../app/api/product-tracker/route.js");
    const response = await GET(
      new NextRequest(
        "https://rizpoint.test/api/product-tracker?marketplaceId=ATVPDKIKX0DER&limit=999",
      ),
    );
    expect(response.status).toBe(200);
    expect(listProductTracker).toHaveBeenCalledWith({
      organizationId: "org-current",
      marketplaceId: "ATVPDKIKX0DER",
      offset: 0,
      limit: 100,
    });
  });
});
