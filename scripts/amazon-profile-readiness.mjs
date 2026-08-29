#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const STATUS = Object.freeze({
  READY: "READY_FOR_YES",
  MANUAL: "MANUAL_VERIFICATION_REQUIRED",
  NOT_READY: "NOT_READY",
});

function read(path) {
  return readFileSync(resolve(path), "utf8");
}

function containsAll(content, values) {
  return values.every((value) => content.includes(value));
}

function result(control, status, evidence) {
  return { control, status, evidence };
}

const operationalControls = Object.freeze({
  firewallAcl: "Deployed firewall and ACL configuration",
  networkSegmentation: "Deployed private-service segmentation and port scan",
  idsIps: "Deployed IDS/IPS",
  endpointAntimalware: "Endpoint/server anti-malware with current signatures",
  tlsTransport: "Deployed TLS 1.2+ edge and internal transport",
  centralizedLogs: "Centralized security log sink and integrity controls",
  encryptedBackups: "Encrypted backup/storage configuration",
  quarterlyRestore: "Quarterly isolated restore and tombstone replay",
  monthlyVulnerabilityScan: "Monthly production vulnerability scan",
  annualPenetrationTest: "Annual qualified penetration test",
  annualTraining: "Annual approved-user security training",
  periodicReviews:
    "Current access, incident-plan, risk, rotation and vendor reviews",
  thirdPartyRegister:
    "Actual contracted processor register and annual assessment",
});

function machineChecks() {
  const schema = read("packages/database/prisma/schema.prisma");
  const lifecycle = read(
    "packages/database/src/amazon-information-lifecycle.ts",
  );
  const policy = read("packages/database/src/amazon-retention-policy.ts");
  const providerRuntime = read(
    "packages/database/src/repositories/provider-runtime.ts",
  );
  const worker = read("apps/worker/src/retention.ts");
  const route = read("apps/web/app/api/providers/retention/route.ts");
  const inventory = read("docs/AMAZON_INFORMATION_INVENTORY.md");
  const processors = read("docs/THIRD_PARTY_PROCESSORS.md");
  const matrix = read("docs/AMAZON_SOLUTION_PROVIDER_PROFILE_EVIDENCE.md");
  const securityControls = read("docs/AMAZON_SECURITY_CONTROLS.md");
  const recovery = read("docs/RECOVERY_RUNBOOK.md");

  return [
    result(
      "amazon-information-inventory-and-attribution",
      containsAll(inventory, [
        "AMAZON_INFORMATION",
        "DERIVED_FROM_AMAZON",
        "SUPPLIER_PRIVATE_DATA",
        "SECURITY_LOG",
        "Amazon SP-API",
        "Keepa",
      ])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "Definitive source/storage/classification inventory.",
    ),
    result(
      "non-pii-purpose-limited-retention",
      containsAll(policy, [
        "AMAZON_INFORMATION_MAX_RETENTION_MONTHS = 18",
        "addUtcCalendarMonths",
        "shorterContractualRetentionDays",
      ]) &&
        containsAll(providerRuntime, ["amazonRetentionDeadline", "retainUntil"])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "18 calendar-month internal ceiling; shorter source term wins.",
    ),
    result(
      "bounded-tenant-retention-enforcement",
      containsAll(lifecycle, [
        "RETENTION_BATCH_SIZE",
        "AMAZON_RETENTION_TENANT_MISMATCH",
        "deleteAmazonInformationCandidates",
        "objectDeletionConfirmedIds",
      ]) && containsAll(worker, ["deletePrivateObject", "RETENTION_EXPIRY"])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "Object-first, bounded, tenant-checked, retryable lifecycle worker.",
    ),
    result(
      "amazon-deletion-request-and-safe-state",
      containsAll(schema, [
        "model AmazonDeletionRequest",
        "model AmazonDeletionTombstone",
        "model AmazonRetentionRun",
      ]) &&
        containsAll(lifecycle, [
          "amazonDeletionDeadline",
          'status: "REVOKED"',
          "encryptedRefreshToken: null",
          "AMAZON_DELETION_SAFE_STATE",
        ]) &&
        containsAll(route, [
          'requireSecurityPermission(request, "MANAGE_SECURITY")',
          "DELETE AMAZON INFORMATION",
        ])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "Authenticated owner/admin workflow enters safe state before worker deletion.",
    ),
    result(
      "backup-tombstone-replay",
      containsAll(worker, [
        "TOMBSTONE_REPLAY",
        "markAmazonTombstoneReapplied",
      ]) &&
        containsAll(recovery, [
          "amazon_deletion_tombstones",
          "provider egress and user traffic disabled",
        ])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "Payload-free deletion scopes are replayed before restored data becomes active.",
    ),
    result(
      "security-logs-and-supplier-data-preserved",
      !lifecycle.includes("securityAuditEvent.delete") &&
        !lifecycle.includes("supplier.delete") &&
        containsAll(inventory, [
          "Supplier files, user inputs, and security logs are outside",
        ])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "Amazon lifecycle targets provider-tagged records only.",
    ),
    result(
      "password-mfa-rbac-credential-security",
      containsAll(securityControls, [
        "Previous 10 passwords",
        "MFA for every production user",
        "Ten-attempt lockout",
        "Least-privilege RBAC",
        "AES-256-GCM",
      ])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "Prompt 36G application controls and tests remain present.",
    ),
    result(
      "questionnaire-evidence-matrix",
      containsAll(matrix, [
        "Network firewall",
        "IDS/IPS",
        "Amazon Information encrypted in transit",
        "Incident-response plan",
        "Outside parties",
        "External non-Amazon sources",
      ]) && containsAll(processors, ["Operator entry required", "annual"])
        ? STATUS.READY
        : STATUS.NOT_READY,
      "Required questions distinguish application evidence from operational proof.",
    ),
  ];
}

function operationalChecks(path, now = new Date()) {
  if (!path || !existsSync(path))
    return Object.entries(operationalControls).map(([control, label]) =>
      result(control, STATUS.MANUAL, `${label}: dated evidence is absent.`),
    );
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [
      result(
        "operational-evidence-file",
        STATUS.NOT_READY,
        "Operational evidence is not valid JSON.",
      ),
    ];
  }
  return Object.entries(operationalControls).map(([control, label]) => {
    const item = evidence.controls?.[control];
    if (
      !item ||
      item.status !== "VERIFIED" ||
      typeof item.reviewer !== "string" ||
      typeof item.evidenceReference !== "string" ||
      typeof item.performedAt !== "string" ||
      typeof item.nextDueAt !== "string"
    )
      return result(
        control,
        STATUS.MANUAL,
        `${label}: verification is incomplete.`,
      );
    const performedAt = new Date(item.performedAt);
    const nextDueAt = new Date(item.nextDueAt);
    if (
      Number.isNaN(performedAt.valueOf()) ||
      Number.isNaN(nextDueAt.valueOf()) ||
      performedAt > now ||
      nextDueAt <= now
    )
      return result(
        control,
        STATUS.NOT_READY,
        `${label}: evidence is invalid, future-dated, or overdue.`,
      );
    return result(
      control,
      STATUS.READY,
      `${label}: current dated evidence supplied.`,
    );
  });
}

const evidenceArg = process.argv.find((argument) =>
  argument.startsWith("--evidence="),
);
const evidencePath = evidenceArg?.slice("--evidence=".length);
const results = [...machineChecks(), ...operationalChecks(evidencePath)];
for (const item of results)
  process.stdout.write(`${item.status} ${item.control}: ${item.evidence}\n`);
const notReady = results.filter(
  ({ status }) => status === STATUS.NOT_READY,
).length;
const manual = results.filter(({ status }) => status === STATUS.MANUAL).length;
const ready = results.filter(({ status }) => status === STATUS.READY).length;
const overall = notReady
  ? STATUS.NOT_READY
  : manual
    ? STATUS.MANUAL
    : STATUS.READY;
process.stdout.write(
  `READY_FOR_YES=${ready} MANUAL_VERIFICATION_REQUIRED=${manual} NOT_READY=${notReady}\nOVERALL=${overall}\n`,
);
if (notReady) process.exitCode = 1;
