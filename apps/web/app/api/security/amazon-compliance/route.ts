import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  recordSecurityAuditEvent,
  saveAmazonDeploymentSecuritySnapshot,
} from "@rizpoint/database";
import {
  getAmazonComplianceStatus,
  verifyDeploymentReport,
} from "@/src/security/amazon-compliance";
import { requireSecurityPermission } from "@/src/security/security-principal";

export const runtime = "nodejs";
const inputSchema = z.object({
  reportText: z.string().min(10).max(512_000),
  signatureBase64: z.string().min(20).max(4_096),
});

function owner(request: NextRequest) {
  const access = requireSecurityPermission(request, "MANAGE_SECURITY");
  if (access.denied) return access;
  if (access.principal.role !== "OWNER")
    return {
      principal: null,
      denied: NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 403 }),
    } as const;
  return access;
}

export async function GET(request: NextRequest) {
  const access = owner(request);
  if (access.denied) return access.denied;
  return NextResponse.json(
    await getAmazonComplianceStatus(access.principal.organizationId),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const access = owner(request);
  if (access.denied) return access.denied;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "DEPLOYMENT_REPORT_INPUT_INVALID" },
      { status: 400 },
    );
  try {
    const publicKeyPath =
      process.env.AMAZON_DEPLOYMENT_ATTESTATION_PUBLIC_KEY_FILE;
    if (!publicKeyPath?.startsWith("/run/secrets/"))
      throw new Error("DEPLOYMENT_EVIDENCE_TRUST_ANCHOR_NOT_CONFIGURED");
    const trustedPublicKey = await readFile(publicKeyPath, "utf8");
    const report = verifyDeploymentReport({ ...input.data, trustedPublicKey });
    const observedAt = new Date(report.generatedAt);
    await saveAmazonDeploymentSecuritySnapshot({
      organizationId: access.principal.organizationId,
      importedByUserId: access.principal.userId,
      deploymentId: report.deploymentId,
      observedAt,
      verifierVersion: report.schemaVersion,
      overallStatus: "VERIFIED",
      reportDigest: report.digest,
      signerFingerprint: report.signerFingerprint,
      controls: report.controls,
    });
    await recordSecurityAuditEvent({
      organizationId: access.principal.organizationId,
      actorUserId: access.principal.userId,
      eventType: "CONFIGURATION_CHANGED",
      outcome: "SUCCESS",
      source: "AMAZON_COMPLIANCE",
      idempotencyKey: `deployment-security:${report.digest}`,
      context: {
        deploymentId: report.deploymentId,
        reportDigest: report.digest,
        observedAt: report.generatedAt,
      },
    });
    return NextResponse.json(
      { status: "VERIFIED_REPORT_IMPORTED" },
      { status: 201 },
    );
  } catch (error) {
    const reference = createHash("sha256")
      .update(error instanceof Error ? error.message : "unknown")
      .digest("hex")
      .slice(0, 12);
    return NextResponse.json(
      { error: "DEPLOYMENT_REPORT_REJECTED", reference },
      { status: 400 },
    );
  }
}
