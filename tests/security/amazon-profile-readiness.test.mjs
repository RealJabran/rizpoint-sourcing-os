import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const manualControls = [
  "firewallAcl",
  "networkSegmentation",
  "idsIps",
  "endpointAntimalware",
  "tlsTransport",
  "centralizedLogs",
  "encryptedBackups",
  "quarterlyRestore",
  "monthlyVulnerabilityScan",
  "annualPenetrationTest",
  "annualTraining",
  "periodicReviews",
  "thirdPartyRegister",
];

test("profile readiness never converts missing deployment proof into YES", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/amazon-profile-readiness.mjs"],
    { encoding: "utf8" },
  );
  assert.match(output, /READY_FOR_YES non-pii-purpose-limited-retention/);
  assert.match(output, /MANUAL_VERIFICATION_REQUIRED firewallAcl/);
  assert.match(output, /NOT_READY=0/);
  assert.match(output, /OVERALL=MANUAL_VERIFICATION_REQUIRED/);
});

test("profile readiness rejects overdue operational attestations", () => {
  const directory = mkdtempSync(join(tmpdir(), "rizpoint-profile-"));
  const evidencePath = join(directory, "evidence.json");
  writeFileSync(
    evidencePath,
    JSON.stringify({
      schemaVersion: 1,
      controls: Object.fromEntries(
        manualControls.map((control) => [
          control,
          {
            status: "VERIFIED",
            reviewer: "Test reviewer",
            evidenceReference: `private://test/${control}`,
            performedAt: "2020-01-01T00:00:00.000Z",
            nextDueAt: "2020-02-01T00:00:00.000Z",
          },
        ]),
      ),
    }),
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/amazon-profile-readiness.mjs", `--evidence=${evidencePath}`],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /NOT_READY firewallAcl/);
  assert.match(result.stdout, /OVERALL=NOT_READY/);
});
