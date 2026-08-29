import { createHash } from "node:crypto";
import { Prisma } from "./generated/prisma/client.js";
import {
  type SecurityAlertType,
  type SecurityAuditEventType,
  type SecurityControlResult,
  type SecurityControlType,
  type SecurityEventOutcome,
  type SecurityIncidentSeverity,
} from "./generated/prisma/client.js";
import { db } from "./client.js";

export const SECURITY_LOG_RETENTION_MONTHS = 12;
export const AMAZON_INCIDENT_NOTIFICATION_HOURS = 24;
export const SECURITY_LOG_REVIEW_DAYS = 14;

const forbiddenContextKey =
  /(password|token|secret|authorization|credential|cookie|buyer|supplier.*content|payload|body|header)/iu;

export const SECURITY_ALERT_CATALOG: Readonly<
  Record<SecurityAlertType, { severity: "CRITICAL" | "HIGH" | "MEDIUM" }>
> = {
  REPEATED_AUTH_FAILURES: { severity: "HIGH" },
  ACCOUNT_LOCKOUT: { severity: "HIGH" },
  MFA_FAILURES: { severity: "HIGH" },
  UNEXPECTED_ADMIN_ACTION: { severity: "HIGH" },
  CREDENTIAL_CHANGE: { severity: "CRITICAL" },
  AMAZON_AUTHORIZATION_SPIKE: { severity: "HIGH" },
  AMAZON_THROTTLE_ANOMALY: { severity: "MEDIUM" },
  PROVIDER_RATE_ANOMALY: { severity: "HIGH" },
  MALWARE_DETECTION: { severity: "CRITICAL" },
  BACKUP_FAILURE: { severity: "CRITICAL" },
  RESTORE_TEST_FAILURE: { severity: "HIGH" },
  LOG_PIPELINE_FAILURE: { severity: "CRITICAL" },
  DATASTORE_READINESS_FAILURE: { severity: "HIGH" },
  SECRET_SCAN_FAILURE: { severity: "CRITICAL" },
};

export const SECURITY_CONTROL_MAX_AGE_DAYS: Readonly<
  Record<SecurityControlType, number>
> = {
  SECURITY_LOG_REVIEW: 14,
  INCIDENT_RESPONSE_PLAN_REVIEW: 183,
  VULNERABILITY_SCAN: 30,
  MALWARE_UPDATE_REVIEW: 30,
  ACCESS_REVIEW: 92,
  BACKUP_RESTORE_TEST: 92,
  RISK_ASSESSMENT: 365,
  PENETRATION_TEST: 365,
  API_CREDENTIAL_ROTATION: 365,
  ENCRYPTION_KEY_ROTATION: 365,
  SECURITY_AWARENESS_TRAINING: 365,
  THIRD_PARTY_RISK_REVIEW: 365,
};

function addUtcMonths(value: Date, months: number): Date {
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

function securityControlNextDueAt(
  controlType: SecurityControlType,
  performedAt: Date,
) {
  if (controlType === "SECURITY_LOG_REVIEW")
    return new Date(performedAt.getTime() + 14 * 86_400_000);
  if (
    controlType === "VULNERABILITY_SCAN" ||
    controlType === "MALWARE_UPDATE_REVIEW"
  )
    return new Date(performedAt.getTime() + 30 * 86_400_000);
  if (controlType === "INCIDENT_RESPONSE_PLAN_REVIEW")
    return addUtcMonths(performedAt, 6);
  if (controlType === "ACCESS_REVIEW" || controlType === "BACKUP_RESTORE_TEST")
    return addUtcMonths(performedAt, 3);
  return addUtcMonths(performedAt, 12);
}

function boundedText(value: string | undefined, maximum = 500): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.slice(0, maximum);
}

export function hashSecurityPrincipal(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sanitizeSecurityContext(
  input: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  if (!input) return undefined;
  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (forbiddenContextKey.test(key)) continue;
    if (raw === null) continue;
    if (typeof raw === "boolean" || typeof raw === "number") {
      output[key] = raw;
      continue;
    }
    if (typeof raw === "string") output[key] = raw.slice(0, 500);
  }
  return output as Prisma.InputJsonObject;
}

export function securityEventLogProjection(input: {
  timestamp: Date;
  organizationId: string;
  actorUserId?: string | null;
  eventType: SecurityAuditEventType;
  outcome: SecurityEventOutcome;
  source: string;
  requestCorrelationId?: string | null;
  context?: Record<string, unknown>;
}) {
  return {
    timestamp: input.timestamp.toISOString(),
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    eventType: input.eventType,
    outcome: input.outcome,
    source: input.source,
    requestCorrelationId: boundedText(
      input.requestCorrelationId ?? undefined,
      128,
    ),
    context: sanitizeSecurityContext(input.context) ?? {},
  };
}

export async function recordSecurityAuditEvent(input: {
  organizationId: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  eventType: SecurityAuditEventType;
  outcome: SecurityEventOutcome;
  source?: string;
  requestCorrelationId?: string;
  sourcePrincipal?: string;
  idempotencyKey?: string;
  context?: Record<string, unknown>;
  now?: Date;
  emit?: (projection: ReturnType<typeof securityEventLogProjection>) => void;
}) {
  const now = input.now ?? new Date();
  const source = boundedText(input.source, 64) ?? "APPLICATION";
  const context = sanitizeSecurityContext(input.context);
  const data = {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? null,
    eventType: input.eventType,
    outcome: input.outcome,
    source,
    requestCorrelationId: boundedText(input.requestCorrelationId, 128),
    sourcePrincipalHash: input.sourcePrincipal
      ? hashSecurityPrincipal(input.sourcePrincipal)
      : null,
    idempotencyKey: boundedText(input.idempotencyKey, 200),
    ...(context ? { context } : {}),
    createdAt: now,
    retentionUntil: new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + SECURITY_LOG_RETENTION_MONTHS,
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
        now.getUTCMilliseconds(),
      ),
    ),
  };
  const event = input.idempotencyKey
    ? await db.securityAuditEvent.upsert({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        update: {},
        create: data,
      })
    : await db.securityAuditEvent.create({ data });
  input.emit?.(
    securityEventLogProjection({
      timestamp: event.createdAt,
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      eventType: event.eventType,
      outcome: event.outcome,
      source: event.source,
      requestCorrelationId: event.requestCorrelationId,
      ...((event.context as Record<string, unknown> | null)
        ? { context: event.context as Record<string, unknown> }
        : {}),
    }),
  );
  return event;
}

export async function recordSecurityControl(input: {
  organizationId: string;
  reviewerUserId?: string;
  controlType: SecurityControlType;
  result: SecurityControlResult;
  performedAt: Date;
  periodStartedAt?: Date;
  periodEndedAt?: Date;
  evidenceReference?: string;
  summary: string;
  findings?: string[];
  actionItems?: Array<{ owner: string; dueAt: string; action: string }>;
  idempotencyKey: string;
}) {
  const nextDueAt = securityControlNextDueAt(
    input.controlType,
    input.performedAt,
  );
  if (
    input.periodStartedAt &&
    input.periodEndedAt &&
    input.periodStartedAt > input.periodEndedAt
  )
    throw new Error("SECURITY_CONTROL_PERIOD_INVALID");
  return db.securityControlRecord.upsert({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      reviewerUserId: input.reviewerUserId ?? null,
      controlType: input.controlType,
      result: input.result,
      performedAt: input.performedAt,
      nextDueAt,
      periodStartedAt: input.periodStartedAt ?? null,
      periodEndedAt: input.periodEndedAt ?? null,
      evidenceReference: boundedText(input.evidenceReference, 500),
      summary: input.summary.trim().slice(0, 2_000),
      findings: input.findings ?? Prisma.JsonNull,
      actionItems: input.actionItems ?? Prisma.JsonNull,
      idempotencyKey: input.idempotencyKey.slice(0, 200),
    },
  });
}

export async function createSecurityIncident(input: {
  organizationId: string;
  reference: string;
  title: string;
  severity: SecurityIncidentSeverity;
  detectedAt: Date;
  amazonInformationOrAccessInvolved: boolean;
  incidentCommanderUserId?: string;
  nonSensitiveSummary: string;
}) {
  return db.securityIncident.create({
    data: {
      organizationId: input.organizationId,
      reference: input.reference.trim().slice(0, 100),
      title: input.title.trim().slice(0, 200),
      severity: input.severity,
      detectedAt: input.detectedAt,
      amazonNotificationRequired: input.amazonInformationOrAccessInvolved,
      amazonNotificationDueAt: input.amazonInformationOrAccessInvolved
        ? new Date(
            input.detectedAt.getTime() +
              AMAZON_INCIDENT_NOTIFICATION_HOURS * 60 * 60_000,
          )
        : null,
      incidentCommanderUserId: input.incidentCommanderUserId ?? null,
      nonSensitiveSummary: input.nonSensitiveSummary.trim().slice(0, 2_000),
    },
  });
}

export async function recordAmazonIncidentNotification(input: {
  organizationId: string;
  incidentId: string;
  notifiedAt: Date;
  amazonIncidentReference: string;
}) {
  const incident = await db.securityIncident.findFirst({
    where: { id: input.incidentId, organizationId: input.organizationId },
  });
  if (!incident) throw new Error("SECURITY_INCIDENT_NOT_FOUND");
  if (!incident.amazonNotificationRequired)
    throw new Error("AMAZON_NOTIFICATION_NOT_REQUIRED");
  return db.securityIncident.update({
    where: { id: incident.id },
    data: {
      amazonNotifiedAt: input.notifiedAt,
      amazonIncidentReference: input.amazonIncidentReference
        .trim()
        .slice(0, 200),
    },
  });
}

function securityAlertDedupeKey(
  organizationId: string,
  alertType: SecurityAlertType,
  windowStart: Date,
) {
  return createHash("sha256")
    .update(`${organizationId}:${alertType}:${windowStart.toISOString()}`)
    .digest("hex");
}

export async function createSecurityAlert(input: {
  organizationId: string;
  alertType: SecurityAlertType;
  observedAt: Date;
  windowStart: Date;
  requestCorrelationId?: string;
  triggerInputs: Record<string, string | number | boolean | null>;
}) {
  const catalog = SECURITY_ALERT_CATALOG[input.alertType];
  return db.securityAlert.upsert({
    where: {
      organizationId_dedupeKey: {
        organizationId: input.organizationId,
        dedupeKey: securityAlertDedupeKey(
          input.organizationId,
          input.alertType,
          input.windowStart,
        ),
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      alertType: input.alertType,
      severity: catalog.severity,
      dedupeKey: securityAlertDedupeKey(
        input.organizationId,
        input.alertType,
        input.windowStart,
      ),
      observedAt: input.observedAt,
      requestCorrelationId: boundedText(input.requestCorrelationId, 128),
      triggerInputs: sanitizeSecurityContext(input.triggerInputs) ?? {},
    },
  });
}

export async function evaluateSecuritySignals(now = new Date()) {
  const windowStart = new Date(now.getTime() - 15 * 60_000);
  const [
    loginFailures,
    lockouts,
    mfaFailures,
    amazonAuth,
    throttles,
    requests,
  ] = await Promise.all([
    db.securityAuditEvent.groupBy({
      by: ["organizationId"],
      where: {
        eventType: "LOGIN_FAILURE",
        createdAt: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    db.securityAuditEvent.groupBy({
      by: ["organizationId"],
      where: {
        eventType: "ACCOUNT_LOCKED",
        createdAt: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    db.securityAuditEvent.groupBy({
      by: ["organizationId"],
      where: {
        eventType: "MFA_CHALLENGE_FAILED",
        createdAt: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    db.providerRequestAttempt.groupBy({
      by: ["organizationId"],
      where: {
        providerKey: "amazon-sp-api",
        httpStatus: { in: [401, 403] },
        createdAt: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    db.providerRequestAttempt.groupBy({
      by: ["organizationId"],
      where: {
        providerKey: "amazon-sp-api",
        httpStatus: 429,
        createdAt: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    db.providerRequestAttempt.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: windowStart } },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map<string, Partial<Record<SecurityAlertType, number>>>();
  const addCounts = (
    type: SecurityAlertType,
    rows: Array<{ organizationId: string; _count: { _all: number } }>,
  ) => {
    for (const row of rows) {
      const organizationCounts = counts.get(row.organizationId) ?? {};
      organizationCounts[type] = row._count._all;
      counts.set(row.organizationId, organizationCounts);
    }
  };
  addCounts("REPEATED_AUTH_FAILURES", loginFailures);
  addCounts("ACCOUNT_LOCKOUT", lockouts);
  addCounts("MFA_FAILURES", mfaFailures);
  addCounts("AMAZON_AUTHORIZATION_SPIKE", amazonAuth);
  addCounts("AMAZON_THROTTLE_ANOMALY", throttles);
  addCounts("PROVIDER_RATE_ANOMALY", requests);
  let alertsCreated = 0;
  for (const [organizationId, organizationCounts] of counts) {
    const candidates: Array<{
      type: SecurityAlertType;
      count: number;
      threshold: number;
    }> = [
      {
        type: "REPEATED_AUTH_FAILURES",
        count: organizationCounts.REPEATED_AUTH_FAILURES ?? 0,
        threshold: 5,
      },
      {
        type: "ACCOUNT_LOCKOUT",
        count: organizationCounts.ACCOUNT_LOCKOUT ?? 0,
        threshold: 1,
      },
      {
        type: "MFA_FAILURES",
        count: organizationCounts.MFA_FAILURES ?? 0,
        threshold: 5,
      },
      {
        type: "AMAZON_AUTHORIZATION_SPIKE",
        count: organizationCounts.AMAZON_AUTHORIZATION_SPIKE ?? 0,
        threshold: 3,
      },
      {
        type: "AMAZON_THROTTLE_ANOMALY",
        count: organizationCounts.AMAZON_THROTTLE_ANOMALY ?? 0,
        threshold: 5,
      },
      {
        type: "PROVIDER_RATE_ANOMALY",
        count: organizationCounts.PROVIDER_RATE_ANOMALY ?? 0,
        threshold: 250,
      },
    ];
    for (const candidate of candidates) {
      if (candidate.count < candidate.threshold) continue;
      await createSecurityAlert({
        organizationId,
        alertType: candidate.type,
        observedAt: now,
        windowStart,
        triggerInputs: {
          count: candidate.count,
          threshold: candidate.threshold,
          windowMinutes: 15,
        },
      });
      alertsCreated += 1;
    }
  }
  return { organizationsEvaluated: counts.size, alertsCreated };
}

export async function listSecurityOperationsStatus(
  organizationId: string,
  now = new Date(),
) {
  const [records, alerts, incidents] = await Promise.all([
    db.securityControlRecord.findMany({
      where: { organizationId },
      orderBy: { performedAt: "desc" },
    }),
    db.securityAlert.findMany({
      where: { organizationId, status: "OPEN" },
      orderBy: { observedAt: "desc" },
      take: 50,
    }),
    db.securityIncident.findMany({
      where: { organizationId, status: { not: "CLOSED" } },
      orderBy: { detectedAt: "desc" },
      take: 20,
    }),
  ]);
  const latest = new Map<SecurityControlType, (typeof records)[number]>();
  for (const record of records)
    if (!latest.has(record.controlType)) latest.set(record.controlType, record);
  return {
    controls: Object.entries(SECURITY_CONTROL_MAX_AGE_DAYS).map(
      ([controlType, maximumAgeDays]) => {
        const record = latest.get(controlType as SecurityControlType);
        return {
          controlType,
          maximumAgeDays,
          lastPerformedAt: record?.performedAt ?? null,
          nextDueAt: record?.nextDueAt ?? null,
          result: record?.result ?? null,
          overdue: !record || record.nextDueAt <= now,
        };
      },
    ),
    alerts,
    incidents,
  };
}
