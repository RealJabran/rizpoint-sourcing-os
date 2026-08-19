import { createHash } from "node:crypto";
import { Prisma } from "./generated/prisma/client.js";
import { db } from "./client.js";
export function evaluateAlert(
  operator:
    | "GREATER_THAN"
    | "GREATER_THAN_OR_EQUAL"
    | "LESS_THAN"
    | "LESS_THAN_OR_EQUAL"
    | "EQUAL"
    | "CHANGED",
  threshold: string | null,
  value: string | null,
) {
  if (value === null)
    return { triggered: false, reason: "MISSING_DATA" } as const;
  if (operator === "CHANGED")
    return { triggered: true, reason: "VALUE_OBSERVED" } as const;
  if (threshold === null)
    return { triggered: false, reason: "THRESHOLD_REQUIRED" } as const;
  const a = Number(value),
    b = Number(threshold);
  return {
    triggered:
      operator === "GREATER_THAN"
        ? a > b
        : operator === "GREATER_THAN_OR_EQUAL"
          ? a >= b
          : operator === "LESS_THAN"
            ? a < b
            : operator === "LESS_THAN_OR_EQUAL"
              ? a <= b
              : a === b,
    reason: "THRESHOLD_EVALUATED",
  } as const;
}
export function alertDedupeKey(
  ruleId: string,
  observedAt: Date,
  value: string,
) {
  return createHash("sha256")
    .update(`${ruleId}:${observedAt.toISOString()}:${value}`)
    .digest("hex");
}
export async function evaluateDueAlertRules() {
  const now = new Date();
  const rules = await db.alertRule.findMany({
    where: { status: "ACTIVE" },
    take: 500,
  });
  let triggered = 0;
  for (const rule of rules) {
    const series = await db.historicalMetricSeries.findFirst({
      where: {
        organizationId: rule.organizationId,
        marketplaceId: rule.marketplaceId,
        subjectType: rule.subjectType,
        subjectKey: rule.subjectKey,
        metricKey: rule.metricKey,
      },
      include: { points: { orderBy: { metricAt: "desc" }, take: 1 } },
    });
    const point = series?.points[0];
    const value =
      point?.decimalValue?.toString() ??
      point?.integerValue?.toString() ??
      null;
    const result = evaluateAlert(
      rule.operator,
      rule.threshold?.toString() ?? null,
      value,
    );
    await db.alertRule.update({
      where: { id: rule.id },
      data: { lastEvaluatedAt: now },
    });
    if (!result.triggered || !point || value === null) continue;
    const recent = await db.alertEvent.findFirst({
      where: {
        organizationId: rule.organizationId,
        alertRuleId: rule.id,
        triggeredAt: {
          gte: new Date(now.getTime() - rule.cooldownMinutes * 60_000),
        },
      },
      orderBy: { triggeredAt: "desc" },
    });
    if (recent) continue;
    await db.alertEvent.upsert({
      where: {
        alertRuleId_dedupeKey: {
          alertRuleId: rule.id,
          dedupeKey: alertDedupeKey(rule.id, point.metricAt, value),
        },
      },
      update: {},
      create: {
        organizationId: rule.organizationId,
        alertRuleId: rule.id,
        dedupeKey: alertDedupeKey(rule.id, point.metricAt, value),
        severity:
          rule.metricKey.includes("COMPLIANCE") ||
          rule.metricKey.includes("OUT_OF_STOCK")
            ? "HIGH"
            : "INFO",
        observedAt: point.metricAt,
        sourceObservationRefs: [point.sourceObservationId],
        payload: {
          metricKey: rule.metricKey,
          operator: rule.operator,
          threshold: rule.threshold?.toString() ?? null,
          observedValue: value,
          reason: result.reason,
        } as Prisma.InputJsonValue,
      },
    });
    triggered++;
  }
  return { rulesEvaluated: rules.length, triggered };
}
export async function listAlertNotifications(organizationId: string) {
  return db.alertEvent.findMany({
    where: { organizationId },
    include: { alertRule: true },
    orderBy: { triggeredAt: "desc" },
    take: 100,
  });
}
export async function acknowledgeAlertNotification(
  organizationId: string,
  id: string,
) {
  const updated = await db.alertEvent.updateMany({
    where: { id, organizationId, status: "OPEN" },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
  });
  if (!updated.count) throw new Error("ALERT_EVENT_NOT_FOUND_OR_NOT_OPEN");
  return db.alertEvent.findFirstOrThrow({ where: { id, organizationId } });
}
