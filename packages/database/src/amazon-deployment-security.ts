import { db } from "./client.js";

export type DeploymentSecurityControl = {
  id: string;
  label: string;
  status: "VERIFIED";
  detail: string;
};

export async function saveAmazonDeploymentSecuritySnapshot(input: {
  organizationId: string;
  importedByUserId: string;
  deploymentId: string;
  observedAt: Date;
  verifierVersion: number;
  overallStatus: "VERIFIED";
  reportDigest: string;
  signerFingerprint: string;
  controls: DeploymentSecurityControl[];
  publicCertificateExpiresAt?: Date;
}) {
  return db.$transaction(async (tx) => {
    const membership = await tx.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.importedByUserId,
        },
      },
      select: { active: true, role: true },
    });
    if (!membership?.active || membership.role !== "OWNER")
      throw new Error("AMAZON_DEPLOYMENT_EVIDENCE_OWNER_REQUIRED");
    return tx.amazonDeploymentSecuritySnapshot.upsert({
      where: {
        organizationId_reportDigest: {
          organizationId: input.organizationId,
          reportDigest: input.reportDigest,
        },
      },
      create: input,
      update: {},
      select: {
        id: true,
        observedAt: true,
        overallStatus: true,
        reportDigest: true,
      },
    });
  });
}

export async function getAmazonDeploymentSecuritySnapshot(
  organizationId: string,
) {
  return db.amazonDeploymentSecuritySnapshot.findFirst({
    where: { organizationId },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    select: {
      deploymentId: true,
      observedAt: true,
      verifierVersion: true,
      overallStatus: true,
      reportDigest: true,
      signerFingerprint: true,
      controls: true,
      publicCertificateExpiresAt: true,
      createdAt: true,
    },
  });
}
