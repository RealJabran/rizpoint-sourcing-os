import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const verifyResearchCompanionSession = vi.fn();
const enforceApiRateLimit = vi.fn();
const addProjectItem = vi.fn();
const createProductWatch = vi.fn();

vi.mock("@rizpoint/database", () => ({
  db: { catalogProduct: { findFirst } },
  researchRepository: { addProjectItem, createProductWatch },
}));
vi.mock("@/src/research-companion-session", () => ({
  verifyResearchCompanionSession,
}));
vi.mock("@/src/api-rate-limit", () => ({ enforceApiRateLimit }));

describe("Research Companion tenant boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyResearchCompanionSession.mockReturnValue({
      organizationId: "org-current",
      expiresAt: 2_000_000_000,
    });
    enforceApiRateLimit.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
  });

  it("queries only products in the token tenant's known universe", async () => {
    const { POST } = await import("../app/api/research-companion/route.js");
    const response = await POST(
      new NextRequest("https://rizpoint.test/api/research-companion", {
        method: "POST",
        headers: { authorization: "Bearer companion-token" },
        body: JSON.stringify({
          asin: "B0ABC12345",
          url: "https://www.amazon.com/dp/B0ABC12345",
          action: "analyze",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          asin: "B0ABC12345",
          OR: expect.arrayContaining([
            {
              researchProjectItems: {
                some: { organizationId: "org-current" },
              },
            },
          ]),
        }),
      }),
    );
    expect((await response.json()).product).toBeNull();
  });

  it("does not touch the catalog for an invalid companion session", async () => {
    verifyResearchCompanionSession.mockReturnValue(null);
    const { POST } = await import("../app/api/research-companion/route.js");
    const response = await POST(
      new NextRequest("https://rizpoint.test/api/research-companion", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
