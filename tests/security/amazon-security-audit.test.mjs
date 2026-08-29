import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const controlNames = [
  "centralizedSecurityLogs",
  "securityLogReview",
  "vulnerabilityScan",
  "malwareUpdateReview",
  "accessReview",
  "backupRestoreTest",
  "incidentPlanReview",
  "riskAssessment",
  "penetrationTest",
  "apiCredentialRotation",
  "encryptionKeyRotation",
  "securityTraining",
  "thirdPartyRiskReview",
];

function evidence(performedAt, nextDueAt) {
  return Object.fromEntries(
    controlNames.map((name) => [
      name,
      {
        status: "VERIFIED",
        reviewer: "Test reviewer",
        evidenceReference: `private://test/${name}`,
        performedAt,
        nextDueAt,
      },
    ]),
  );
}

test("Amazon security audit distinguishes missing manual evidence", () => {
  const output = execFileSync(
    process.execPath,
    [
      "scripts/amazon-security-audit.mjs",
      "--evidence=/definitely/missing.json",
    ],
    { encoding: "utf8" },
  );
  assert.match(output, /OVERALL=MANUAL_EVIDENCE_REQUIRED/);
  assert.match(output, /FAIL=0/);
});

test("Amazon security audit fails an overdue manual control", () => {
  const directory = mkdtempSync(join(tmpdir(), "rizpoint-security-audit-"));
  const path = join(directory, "evidence.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      controls: evidence(
        "2020-01-01T00:00:00.000Z",
        "2020-01-02T00:00:00.000Z",
      ),
    }),
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/amazon-security-audit.mjs", `--evidence=${path}`],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /is overdue since/);
  assert.match(result.stdout, /OVERALL=FAIL/);
});
