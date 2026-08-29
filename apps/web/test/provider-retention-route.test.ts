import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAmazonRetentionDashboard = vi.fn();
const createAmazonDeletionRequest = vi.fn();
const requireSecurityPermission = vi.fn();

vi.mock("@rizpoint/database", () => ({
  getAmazonRetentionDashboard,
  createAmazonDeletionRequest,
}));
vi.mock("@/src/security/security-principal", () => ({
  requireSecurityPermission,
}));

describe("Amazon Information retention route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSecurityPermission.mockReturnValue({
      principal: {
        organizationId: "org-current",
        userId: "user-owner",
        role: "OWNER",
      },
      denied: null,
    });
    getAmazonRetentionDashboard.mockResolvedValue({
      policy: { rizpointMaximumCalendarMonths: 18 },
      oldestObservationAt: null,
      nearingExpiryCount: 0,
      deletedRecords: 0,
      failedDeletionJobs: 0,
    });
    createAmazonDeletionRequest.mockResolvedValue({
      duplicate: false,
      request: {
        status: "SAFE_STATE",
        requestedAt: new Date("2026-08-29T00:00:00.000Z"),
        deadlineAt: new Date("2026-09-28T00:00:00.000Z"),
        safeStateAt: new Date("2026-08-29T00:00:00.000Z"),
      },
    });
  });

  it("returns only the authenticated organization's safe dashboard", async () => {
    const { GET } = await import("../app/api/providers/retention/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/providers/retention"),
    );
    expect(response.status).toBe(200);
    expect(getAmazonRetentionDashboard).toHaveBeenCalledWith("org-current");
    expect(JSON.stringify(await response.json())).not.toMatch(
      /refreshToken|accessToken|clientSecret|rawPayload|objectReference/i,
    );
  });

  it("rejects an unconfirmed destructive request", async () => {
    const { POST } = await import("../app/api/providers/retention/route.js");
    const response = await POST(
      new NextRequest("http://localhost/api/providers/retention", {
        method: "POST",
        body: JSON.stringify({
          reason: "OPERATOR_POLICY",
          confirmation: "delete it",
          idempotencyKey: "retention-request-123",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(createAmazonDeletionRequest).not.toHaveBeenCalled();
  });

  it("creates a tenant-scoped safe-state request without returning secrets", async () => {
    const { POST } = await import("../app/api/providers/retention/route.js");
    const response = await POST(
      new NextRequest("http://localhost/api/providers/retention", {
        method: "POST",
        body: JSON.stringify({
          reason: "AMAZON_NOTICE",
          confirmation: "DELETE AMAZON INFORMATION",
          idempotencyKey: "retention-request-123",
        }),
      }),
    );
    expect(response.status).toBe(202);
    expect(createAmazonDeletionRequest).toHaveBeenCalledWith({
      organizationId: "org-current",
      requestedByUserId: "user-owner",
      reason: "AMAZON_NOTICE",
      idempotencyKey: "retention-request-123",
    });
    expect(JSON.stringify(await response.json())).not.toMatch(
      /credential|token|providerPayload|object/i,
    );
  });

  it("does not call lifecycle services when permission is denied", async () => {
    requireSecurityPermission.mockReturnValue({
      principal: null,
      denied: new Response(JSON.stringify({ error: "FORBIDDEN" }), {
        status: 403,
      }),
    });
    const { GET } = await import("../app/api/providers/retention/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/providers/retention"),
    );
    expect(response.status).toBe(403);
    expect(getAmazonRetentionDashboard).not.toHaveBeenCalled();
  });
});
