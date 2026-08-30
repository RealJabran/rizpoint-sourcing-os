import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import {
  getAmazonDeploymentSecuritySnapshot,
  listSecurityOperationsStatus,
} from "@rizpoint/database";

const checkSchema = z.object({
  id: z.string().min(1).max(160),
  status: z.enum(["PASS", "FAIL", "MANUAL_VERIFICATION_REQUIRED"]),
  detail: z.string().min(1).max(2_000),
});

const reportSchema = z.object({
  schemaVersion: z.literal(2),
  generatedAt: z.iso.datetime(),
  deploymentId: z.string().min(3).max(200),
  releaseSha: z.string().min(7).max(80),
  checks: z.array(checkSchema).min(1).max(250),
  summary: z.object({
    PASS: z.number().int().nonnegative(),
    FAIL: z.literal(0),
    MANUAL_VERIFICATION_REQUIRED: z.literal(0),
  }),
  signerPublicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const AMAZON_DEPLOYMENT_CONTROL_REQUIREMENTS = [
  { id: "firewall", label: "Firewall", checks: ["external-hostFirewall"] },
  {
    id: "network-segmentation",
    label: "Network segmentation",
    checks: ["compose-prohibited-paths", "external-networkSegmentation"],
  },
  { id: "waf", label: "WAF", checks: ["external-waf"] },
  { id: "ids-ips", label: "IDS / IPS", checks: ["external-idsIps"] },
  {
    id: "anti-malware",
    label: "Anti-malware",
    checks: ["external-endpointProtection"],
  },
  {
    id: "tls-public",
    label: "TLS public",
    checks: [
      "live-public-tls",
      "live-legacy-tls-rejection",
      "external-publicTls",
    ],
  },
  {
    id: "tls-internal",
    label: "TLS internal",
    checks: ["internal-edge-web-mtls", "external-internalTls"],
  },
  {
    id: "tls-amazon",
    label: "Amazon provider TLS",
    checks: [
      "runtime-sp-api-endpoint",
      "runtime-lwa-endpoint",
      "external-providerTls",
    ],
  },
  {
    id: "tls-database",
    label: "Database TLS",
    checks: ["runtime-database-tls", "external-databaseTls"],
  },
  {
    id: "tls-redis",
    label: "Redis TLS",
    checks: ["runtime-redis-tls", "external-redisTls"],
  },
  {
    id: "tls-storage",
    label: "Storage TLS",
    checks: ["runtime-https-s3_endpoint", "external-storageTls"],
  },
  {
    id: "monitoring",
    label: "Security monitoring",
    checks: ["external-centralizedMonitoring", "external-monitoringTls"],
  },
] as const;

export type VerifiedDeploymentReport = z.infer<typeof reportSchema> & {
  digest: string;
  signerFingerprint: string;
  controls: Array<{
    id: string;
    label: string;
    status: "VERIFIED";
    detail: string;
  }>;
};

export function verifyDeploymentReport(input: {
  reportText: string;
  signatureBase64: string;
  trustedPublicKey: string;
}): VerifiedDeploymentReport {
  if (Buffer.byteLength(input.reportText, "utf8") > 512_000)
    throw new Error("DEPLOYMENT_REPORT_TOO_LARGE");
  const reportBytes = Buffer.from(input.reportText, "utf8");
  const signature = Buffer.from(input.signatureBase64.trim(), "base64");
  if (
    signature.length < 32 ||
    !verify(null, reportBytes, input.trustedPublicKey, signature)
  )
    throw new Error("DEPLOYMENT_REPORT_SIGNATURE_INVALID");
  const report = reportSchema.parse(JSON.parse(input.reportText));
  const calculatedSummary = report.checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { PASS: 0, FAIL: 0, MANUAL_VERIFICATION_REQUIRED: 0 },
  );
  if (
    calculatedSummary.PASS !== report.summary.PASS ||
    calculatedSummary.FAIL !== 0 ||
    calculatedSummary.MANUAL_VERIFICATION_REQUIRED !== 0
  )
    throw new Error("DEPLOYMENT_REPORT_SUMMARY_INVALID");

  const checks = new Map(report.checks.map((check) => [check.id, check]));
  const controls = AMAZON_DEPLOYMENT_CONTROL_REQUIREMENTS.map((control) => {
    const evidence = control.checks.map((id) => checks.get(id));
    if (evidence.some((check) => check?.status !== "PASS"))
      throw new Error(`DEPLOYMENT_REPORT_CONTROL_MISSING:${control.id}`);
    return {
      id: control.id,
      label: control.label,
      status: "VERIFIED" as const,
      detail: evidence
        .map((check) => check?.detail)
        .join(" ")
        .slice(0, 2_000),
    };
  });

  const publicKey = createPublicKey(input.trustedPublicKey);
  const signerFingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  if (signerFingerprint !== report.signerPublicKeyFingerprint)
    throw new Error("DEPLOYMENT_REPORT_SIGNER_MISMATCH");
  return {
    ...report,
    digest: createHash("sha256").update(reportBytes).digest("hex"),
    signerFingerprint,
    controls,
  };
}

export async function getAmazonComplianceStatus(organizationId: string) {
  const [snapshot, operations] = await Promise.all([
    getAmazonDeploymentSecuritySnapshot(organizationId),
    listSecurityOperationsStatus(organizationId),
  ]);
  const controls = Array.isArray(snapshot?.controls)
    ? (snapshot.controls as Array<{
        id: string;
        label: string;
        status: string;
        detail: string;
      }>)
    : AMAZON_DEPLOYMENT_CONTROL_REQUIREMENTS.map((control) => ({
        id: control.id,
        label: control.label,
        status: "MISSING",
        detail:
          "No valid signed deployment report has been imported for this organization.",
      }));
  const operational = new Map(
    operations.controls.map((control) => [control.controlType, control]),
  );
  return {
    deployment: snapshot
      ? {
          deploymentId: snapshot.deploymentId,
          observedAt: snapshot.observedAt.toISOString(),
          overallStatus: snapshot.overallStatus,
          releaseDigest: snapshot.reportDigest.slice(0, 16),
          signerFingerprint: snapshot.signerFingerprint.slice(0, 16),
        }
      : null,
    controls,
    governance: [
      ["Last vulnerability scan", "VULNERABILITY_SCAN"],
      ["Last access review", "ACCESS_REVIEW"],
      ["Last incident-plan review", "INCIDENT_RESPONSE_PLAN_REVIEW"],
    ].map(([label, key]) => {
      const control = operational.get(key as never);
      return {
        label,
        status: control && !control.overdue ? "CURRENT" : "OVERDUE_OR_MISSING",
        lastPerformedAt: control?.lastPerformedAt?.toISOString() ?? null,
        nextDueAt: control?.nextDueAt?.toISOString() ?? null,
      };
    }),
  };
}
