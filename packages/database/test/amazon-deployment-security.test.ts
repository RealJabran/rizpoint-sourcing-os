import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.fn();
const findUnique = vi.fn();
const upsert = vi.fn();
vi.mock("../src/client.js", () => ({
  db: {
    $transaction: transaction,
    amazonDeploymentSecuritySnapshot: { findFirst: vi.fn() },
  },
}));

describe("Amazon deployment evidence tenant boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation((callback) =>
      callback({
        organizationMembership: { findUnique },
        amazonDeploymentSecuritySnapshot: { upsert },
      }),
    );
  });

  it("refuses evidence imports without an active owner membership in the same organization", async () => {
    const { saveAmazonDeploymentSecuritySnapshot } =
      await import("../src/amazon-deployment-security.js");
    findUnique.mockResolvedValue({ active: true, role: "ADMIN" });
    await expect(
      saveAmazonDeploymentSecuritySnapshot({
        organizationId: "org-a",
        importedByUserId: "user-from-org-b",
        deploymentId: "production",
        observedAt: new Date(),
        verifierVersion: 2,
        overallStatus: "VERIFIED",
        reportDigest: "a".repeat(64),
        signerFingerprint: "b".repeat(64),
        controls: [],
      }),
    ).rejects.toThrow("AMAZON_DEPLOYMENT_EVIDENCE_OWNER_REQUIRED");
    expect(upsert).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: {
            organizationId: "org-a",
            userId: "user-from-org-b",
          },
        },
      }),
    );
  });
});
