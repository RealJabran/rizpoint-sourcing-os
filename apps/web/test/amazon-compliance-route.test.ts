import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSecurityPermission = vi.fn();
const getAmazonComplianceStatus = vi.fn();
const verifyDeploymentReport = vi.fn();
const saveAmazonDeploymentSecuritySnapshot = vi.fn();
const recordSecurityAuditEvent = vi.fn();

vi.mock("@/src/security/security-principal", () => ({
  requireSecurityPermission,
}));
vi.mock("@/src/security/amazon-compliance", () => ({
  getAmazonComplianceStatus,
  verifyDeploymentReport,
}));
vi.mock("@rizpoint/database", () => ({
  saveAmazonDeploymentSecuritySnapshot,
  recordSecurityAuditEvent,
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("trusted public key"),
}));

const owner = {
  organizationId: "org-a",
  userId: "owner-a",
  role: "OWNER",
} as const;

describe("Amazon compliance route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("is owner-only and scopes reads to the authenticated organization", async () => {
    requireSecurityPermission.mockReturnValueOnce({
      principal: { ...owner, role: "ADMIN" },
      denied: null,
    });
    const { GET } =
      await import("../app/api/security/amazon-compliance/route.js");
    expect(
      (
        await GET(
          new NextRequest(
            "https://rizpoint.test/api/security/amazon-compliance",
          ),
        )
      ).status,
    ).toBe(403);

    requireSecurityPermission.mockReturnValueOnce({
      principal: owner,
      denied: null,
    });
    getAmazonComplianceStatus.mockResolvedValue({
      deployment: null,
      controls: [],
      governance: [],
    });
    expect(
      (
        await GET(
          new NextRequest(
            "https://rizpoint.test/api/security/amazon-compliance",
          ),
        )
      ).status,
    ).toBe(200);
    expect(getAmazonComplianceStatus).toHaveBeenCalledWith("org-a");
  });

  it("persists verified evidence only in the owner's tenant without returning report content", async () => {
    vi.stubEnv(
      "AMAZON_DEPLOYMENT_ATTESTATION_PUBLIC_KEY_FILE",
      "/run/secrets/rizpoint_deployment_attestation_public_key",
    );
    requireSecurityPermission.mockReturnValue({
      principal: owner,
      denied: null,
    });
    verifyDeploymentReport.mockReturnValue({
      schemaVersion: 2,
      generatedAt: "2026-08-30T10:00:00.000Z",
      deploymentId: "production-a",
      digest: "a".repeat(64),
      signerFingerprint: "b".repeat(64),
      controls: [
        {
          id: "firewall",
          label: "Firewall",
          status: "VERIFIED",
          detail: "verified",
        },
      ],
    });
    const { POST } =
      await import("../app/api/security/amazon-compliance/route.js");
    const response = await POST(
      new NextRequest("https://rizpoint.test/api/security/amazon-compliance", {
        method: "POST",
        body: JSON.stringify({
          reportText: "signed deployment report",
          signatureBase64: "x".repeat(64),
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(201);
    expect(saveAmazonDeploymentSecuritySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        importedByUserId: "owner-a",
      }),
    );
    expect(JSON.stringify(await response.json())).not.toMatch(
      /signed deployment report|trusted public key/i,
    );
  });
});
