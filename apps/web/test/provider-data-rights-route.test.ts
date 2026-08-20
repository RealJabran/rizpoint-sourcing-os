import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePhaseZeroOrganization = vi.fn();
const listProviderCapabilityStates = vi.fn();
const updateProviderDataRights = vi.fn();
const consumeApiRateLimit = vi.fn();
const requirePrivateAccess = vi.fn();
const enforceApiRateLimit = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  listProviderCapabilityStates,
  updateProviderDataRights,
  consumeApiRateLimit,
}));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));
vi.mock("@/src/api-rate-limit", () => ({ enforceApiRateLimit }));

describe("provider data-rights route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePrivateAccess.mockReturnValue(null);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-current" });
    consumeApiRateLimit.mockResolvedValue({ allowed: true });
    enforceApiRateLimit.mockResolvedValue(null);
    updateProviderDataRights.mockResolvedValue({ providerKey: "licensed" });
  });

  it("writes rights only within the authenticated organization context", async () => {
    const { PUT } = await import("../app/api/providers/data-rights/route.js");
    const response = await PUT(
      new NextRequest("http://localhost/api/providers/data-rights", {
        method: "PUT",
        body: JSON.stringify({
          providerKey: "licensed",
          marketplaceId: "ATVPDKIKX0DER",
          capability: "MARKET_HISTORY",
          usageScope: "REDISTRIBUTABLE",
          exportPolicy: "FIELD_ALLOWLIST",
          exportableFields: ["history.rating"],
          retentionDays: 90,
          termsReference: "contract:2026",
          termsVersion: "2026-08",
          termsReviewedAt: "2026-08-19T00:00:00.000Z",
          effectiveAt: "2026-08-19T00:00:00.000Z",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(updateProviderDataRights).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-current",
        providerKey: "licensed",
      }),
    );
  });

  it("does not read or mutate rights when access is denied", async () => {
    requirePrivateAccess.mockReturnValue(
      new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 }),
    );
    const { GET, PUT } =
      await import("../app/api/providers/data-rights/route.js");
    expect(
      (await GET(new NextRequest("http://localhost/api/providers/data-rights")))
        .status,
    ).toBe(401);
    expect(
      (
        await PUT(
          new NextRequest("http://localhost/api/providers/data-rights", {
            method: "PUT",
          }),
        )
      ).status,
    ).toBe(401);
    expect(listProviderCapabilityStates).not.toHaveBeenCalled();
    expect(updateProviderDataRights).not.toHaveBeenCalled();
  });
});
