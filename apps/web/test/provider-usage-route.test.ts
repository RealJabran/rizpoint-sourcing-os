import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getProviderUsageSummary = vi.fn();
const requirePrivateAccess = vi.fn();
const organizationForRequest = vi.fn();

vi.mock("@rizpoint/database", () => ({ getProviderUsageSummary }));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));
vi.mock("@/src/request-organization", () => ({ organizationForRequest }));

describe("provider usage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePrivateAccess.mockReturnValue(null);
    organizationForRequest.mockResolvedValue({ id: "org-current" });
    getProviderUsageSummary.mockResolvedValue({
      since: "2026-07-22T00:00:00.000Z",
      liveProviderCalls: 2,
      cacheHits: 5,
      cacheMisses: 2,
      staleHits: 1,
      refreshes: 1,
      throttles: 0,
      estimatedUsage: [{ unit: "TOKEN", value: "2.0000" }],
      estimatedCost: [],
      providers: ["licensed-fixture"],
    });
  });

  it("uses only the authenticated organization and returns no provider secrets", async () => {
    const { GET } = await import("../app/api/providers/usage/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/providers/usage", {
        headers: { "x-rizpoint-organization-id": "org-current" },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(getProviderUsageSummary).toHaveBeenCalledWith({
      organizationId: "org-current",
    });
    expect(body).toMatchObject({ cacheHits: 5, liveProviderCalls: 2 });
    expect(JSON.stringify(body)).not.toMatch(
      /tokenValue|refreshToken|accessToken|clientSecret|payload|requestInputs/i,
    );
  });

  it("does not query usage when private access is denied", async () => {
    requirePrivateAccess.mockReturnValue(
      new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 }),
    );
    const { GET } = await import("../app/api/providers/usage/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/providers/usage"),
    );
    expect(response.status).toBe(401);
    expect(getProviderUsageSummary).not.toHaveBeenCalled();
  });
});
