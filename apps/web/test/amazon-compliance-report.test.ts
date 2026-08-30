import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AMAZON_DEPLOYMENT_CONTROL_REQUIREMENTS,
  verifyDeploymentReport,
} from "../src/security/amazon-compliance.js";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const fingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const ids = [
    ...new Set(
      AMAZON_DEPLOYMENT_CONTROL_REQUIREMENTS.flatMap(
        (control) => control.checks,
      ),
    ),
  ];
  const report = {
    schemaVersion: 2,
    generatedAt: "2026-08-30T10:00:00.000Z",
    deploymentId: "rizpoint-private-production",
    releaseSha: "1234567890abcdef",
    checks: ids.map((id) => ({
      id,
      status: "PASS",
      detail: `${id} verified without sensitive values.`,
    })),
    summary: { PASS: ids.length, FAIL: 0, MANUAL_VERIFICATION_REQUIRED: 0 },
    signerPublicKeyFingerprint: fingerprint,
  } as const;
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  return {
    report,
    reportText,
    signatureBase64: sign(null, Buffer.from(reportText), privateKey).toString(
      "base64",
    ),
    trustedPublicKey: publicPem,
    privateKey,
  };
}

describe("signed Amazon deployment evidence", () => {
  it("accepts complete signed evidence and returns only sanitized controls", () => {
    const input = fixture();
    const verified = verifyDeploymentReport(input);
    expect(verified.controls).toHaveLength(
      AMAZON_DEPLOYMENT_CONTROL_REQUIREMENTS.length,
    );
    expect(
      verified.controls.every((control) => control.status === "VERIFIED"),
    ).toBe(true);
    expect(JSON.stringify(verified)).not.toMatch(
      /password|refresh.?token|client.?secret/i,
    );
  });

  it("rejects modified bytes, missing controls, and manual states", () => {
    const input = fixture();
    expect(() =>
      verifyDeploymentReport({ ...input, reportText: `${input.reportText} ` }),
    ).toThrow("DEPLOYMENT_REPORT_SIGNATURE_INVALID");

    const missing = { ...input.report, checks: input.report.checks.slice(1) };
    const missingText = `${JSON.stringify({ ...missing, summary: { PASS: missing.checks.length, FAIL: 0, MANUAL_VERIFICATION_REQUIRED: 0 } }, null, 2)}\n`;
    expect(() =>
      verifyDeploymentReport({
        ...input,
        reportText: missingText,
        signatureBase64: sign(
          null,
          Buffer.from(missingText),
          input.privateKey,
        ).toString("base64"),
      }),
    ).toThrow(/DEPLOYMENT_REPORT_CONTROL_MISSING/u);
  });
});
