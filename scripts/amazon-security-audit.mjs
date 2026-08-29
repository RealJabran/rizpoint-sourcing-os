#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const STATUS = {
  PASS: "PASS",
  FAIL: "FAIL",
  MANUAL: "MANUAL_EVIDENCE_REQUIRED",
};

const controls = Object.freeze({
  centralizedSecurityLogs: {
    label: "Centralized security log collection",
    maxAgeDays: 31,
  },
  securityLogReview: { label: "Bi-weekly security-log review", maxAgeDays: 14 },
  vulnerabilityScan: { label: "Monthly vulnerability scan", maxAgeDays: 30 },
  malwareUpdateReview: {
    label: "Monthly anti-malware update review",
    maxAgeDays: 30,
  },
  accessReview: {
    label: "Quarterly personnel/service access review",
    maxAgeMonths: 3,
  },
  backupRestoreTest: {
    label: "Quarterly backup/restore exercise",
    maxAgeMonths: 3,
  },
  incidentPlanReview: {
    label: "Six-month incident-plan review",
    maxAgeMonths: 6,
  },
  riskAssessment: { label: "Annual risk assessment", maxAgeMonths: 12 },
  penetrationTest: {
    label: "Annual qualified penetration test",
    maxAgeMonths: 12,
  },
  apiCredentialRotation: {
    label: "Annual Amazon API credential rotation",
    maxAgeMonths: 12,
  },
  encryptionKeyRotation: {
    label: "Annual encryption-key rotation",
    maxAgeMonths: 12,
  },
  securityTraining: {
    label: "Annual security-awareness training",
    maxAgeMonths: 12,
  },
  thirdPartyRiskReview: {
    label: "Annual third-party risk review",
    maxAgeMonths: 12,
  },
});

function addUtcMonths(value, months) {
  const target = new Date(value);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function result(name, status, detail) {
  return { name, status, detail };
}

function read(path) {
  return readFileSync(resolve(path), "utf8");
}

function containsAll(content, values) {
  return values.every((value) => content.includes(value));
}

function machineChecks() {
  const schema = read("packages/database/prisma/schema.prisma");
  const operations = read("packages/database/src/security-operations.ts");
  const incidentPlan = read("docs/INCIDENT_RESPONSE_PLAN.md");
  const riskRegister = read("docs/SECURITY_RISK_REGISTER.md");
  const vulnerabilities = read("docs/VULNERABILITY_MANAGEMENT.md");
  const recovery = read("docs/RECOVERY_RUNBOOK.md");
  const ci = read(".github/workflows/ci.yml");
  const packageJson = JSON.parse(read("package.json"));
  const checks = [
    result(
      "incident-response-plan",
      containsAll(incidentPlan, [
        "Incident Management Point of Contact",
        "PREPARATION",
        "IDENTIFICATION",
        "CONTAINMENT",
        "ERADICATION",
        "RECOVERY",
        "POST-INCIDENT REVIEW",
        "security@amazon.com",
        "24 hours",
        "next_review_due",
      ])
        ? STATUS.PASS
        : STATUS.FAIL,
      "Formal roles, phases, incident playbooks, notification and review metadata are required.",
    ),
    result(
      "risk-register",
      containsAll(riskRegister, [
        "Asset",
        "Threat",
        "Likelihood",
        "Residual risk",
        "annual",
      ])
        ? STATUS.PASS
        : STATUS.FAIL,
      "The risk register must be reviewable and assigned.",
    ),
    result(
      "vulnerability-lifecycle",
      containsAll(vulnerabilities, [
        "30 days",
        "7 calendar days",
        "annual",
        "penetration",
        "before every release",
      ])
        ? STATUS.PASS
        : STATUS.FAIL,
      "Scanning cadence and critical/high remediation SLAs are documented.",
    ),
    result(
      "structured-security-events",
      containsAll(schema, [
        "model SecurityAuditEvent",
        "outcome",
        "requestCorrelationId",
        "sourcePrincipalHash",
        "retentionUntil",
        "model SecurityAlert",
        "model SecurityControlRecord",
        "model SecurityIncident",
      ]) &&
        containsAll(operations, [
          "sanitizeSecurityContext",
          "SECURITY_LOG_RETENTION_MONTHS = 12",
          "evaluateSecuritySignals",
          "AMAZON_INCIDENT_NOTIFICATION_HOURS = 24",
        ])
        ? STATUS.PASS
        : STATUS.FAIL,
      "Tenant-scoped structured events, retention, alerts, controls and incidents are implemented.",
    ),
    result(
      "security-alert-coverage",
      containsAll(operations, [
        "REPEATED_AUTH_FAILURES",
        "ACCOUNT_LOCKOUT",
        "MFA_FAILURES",
        "CREDENTIAL_CHANGE",
        "AMAZON_AUTHORIZATION_SPIKE",
        "AMAZON_THROTTLE_ANOMALY",
        "PROVIDER_RATE_ANOMALY",
        "MALWARE_DETECTION",
        "BACKUP_FAILURE",
        "RESTORE_TEST_FAILURE",
        "LOG_PIPELINE_FAILURE",
        "DATASTORE_READINESS_FAILURE",
        "SECRET_SCAN_FAILURE",
      ])
        ? STATUS.PASS
        : STATUS.FAIL,
      "Security signals are allowlisted and alerts contain metadata, not payloads.",
    ),
    result(
      "quarterly-recovery-test",
      containsAll(recovery, [
        "quarterly",
        "backup source",
        "restore target",
        "RPO observed",
        "RTO observed",
        "Never restore over production",
      ])
        ? STATUS.PASS
        : STATUS.FAIL,
      "A non-destructive quarterly recovery evidence template is required.",
    ),
    result(
      "automated-security-scanning",
      containsAll(ci, ["schedule:", "pnpm audit", "codeql", "trivy"]) &&
        packageJson.scripts?.["security:amazon:audit"]
        ? STATUS.PASS
        : STATUS.FAIL,
      "CI must schedule dependency, SAST, secret and filesystem/container scanning.",
    ),
  ];

  const dependencyAudit = spawnSync(
    "pnpm",
    ["audit", "--prod", "--audit-level", "high"],
    { encoding: "utf8", timeout: 120_000 },
  );
  checks.push(
    result(
      "dependency-audit-high",
      dependencyAudit.status === 0 ? STATUS.PASS : STATUS.FAIL,
      dependencyAudit.status === 0
        ? dependencyAudit.stdout.trim() ||
            "No high/critical dependency finding."
        : "High/critical dependency findings or an unavailable audit service must be reviewed.",
    ),
  );
  const secretScan = spawnSync("pnpm", ["check:private-assets"], {
    encoding: "utf8",
    timeout: 120_000,
  });
  checks.push(
    result(
      "repository-secret-scan",
      secretScan.status === 0 ? STATUS.PASS : STATUS.FAIL,
      secretScan.status === 0
        ? "Tracked/untracked files and browser artifacts passed the repository secret gate."
        : "Repository secret scan failed or could not run.",
    ),
  );
  return checks;
}

function operationalChecks(path, now = new Date()) {
  if (!existsSync(path))
    return Object.entries(controls).map(([key, control]) =>
      result(
        `operational-${key}`,
        STATUS.MANUAL,
        `${control.label} needs dated evidence from the real private deployment.`,
      ),
    );
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [
      result(
        "operational-evidence-file",
        STATUS.FAIL,
        "Operational evidence is not valid JSON.",
      ),
    ];
  }
  return Object.entries(controls).map(([key, control]) => {
    const item = evidence.controls?.[key];
    if (!item || item.status !== "VERIFIED")
      return result(
        `operational-${key}`,
        STATUS.MANUAL,
        `${control.label} has no verified operator evidence.`,
      );
    if (!item.reviewer || !item.evidenceReference || !item.performedAt)
      return result(
        `operational-${key}`,
        STATUS.FAIL,
        `${control.label} is marked verified without reviewer, evidence reference, and performed time.`,
      );
    const performedAt = new Date(item.performedAt);
    const maximumDueAt = control.maxAgeMonths
      ? addUtcMonths(performedAt, control.maxAgeMonths)
      : new Date(performedAt.getTime() + control.maxAgeDays * 86_400_000);
    const nextDueAt = item.nextDueAt ? new Date(item.nextDueAt) : maximumDueAt;
    if (
      Number.isNaN(performedAt.getTime()) ||
      Number.isNaN(nextDueAt.getTime()) ||
      nextDueAt <= performedAt
    )
      return result(
        `operational-${key}`,
        STATUS.FAIL,
        `${control.label} has invalid evidence dates.`,
      );
    if (nextDueAt > maximumDueAt)
      return result(
        `operational-${key}`,
        STATUS.FAIL,
        `${control.label} next due exceeds its maximum cadence.`,
      );
    if (nextDueAt <= now)
      return result(
        `operational-${key}`,
        STATUS.FAIL,
        `${control.label} is overdue since ${nextDueAt.toISOString()}.`,
      );
    return result(
      `operational-${key}`,
      STATUS.PASS,
      `${control.label} verified by ${item.reviewer}; next due ${nextDueAt.toISOString()}.`,
    );
  });
}

const evidenceArgument = process.argv.find((argument) =>
  argument.startsWith("--evidence="),
);
const evidencePath = resolve(
  evidenceArgument?.slice("--evidence=".length) ??
    "deploy/amazon-hardened/security-operations-evidence.json",
);
const checks = [...machineChecks(), ...operationalChecks(evidencePath)];
for (const check of checks)
  process.stdout.write(
    `${check.status.padEnd(25)} ${check.name}: ${check.detail}\n`,
  );
const summary = checks.reduce(
  (value, check) => {
    value[check.status] += 1;
    return value;
  },
  { [STATUS.PASS]: 0, [STATUS.FAIL]: 0, [STATUS.MANUAL]: 0 },
);
const overall = summary[STATUS.FAIL]
  ? STATUS.FAIL
  : summary[STATUS.MANUAL]
    ? STATUS.MANUAL
    : STATUS.PASS;
process.stdout.write(
  `\nPASS=${summary[STATUS.PASS]} FAIL=${summary[STATUS.FAIL]} MANUAL_EVIDENCE_REQUIRED=${summary[STATUS.MANUAL]}\nOVERALL=${overall}\n`,
);
process.stdout.write(
  "Documentation or elapsed time is never accepted as completed operational evidence.\n",
);
if (
  summary[STATUS.FAIL] ||
  (process.argv.includes("--strict") && summary[STATUS.MANUAL])
)
  process.exitCode = 1;
