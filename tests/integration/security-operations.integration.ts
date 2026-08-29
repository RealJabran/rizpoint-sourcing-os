import assert from "node:assert/strict";
import {
  createSecurityAlert,
  createSecurityIncident,
  db,
  evaluateSecuritySignals,
  listSecurityOperationsStatus,
  recordAmazonIncidentNotification,
  recordSecurityAuditEvent,
  recordSecurityControl,
} from "../../packages/database/src/index.js";

const suffix = crypto.randomUUID();
const first = await db.organization.create({
  data: { slug: `security-ops-a-${suffix}`, name: "Security operations A" },
});
const second = await db.organization.create({
  data: { slug: `security-ops-b-${suffix}`, name: "Security operations B" },
});
const now = new Date("2026-08-29T08:00:00Z");
let emitted = "";
const event = await recordSecurityAuditEvent({
  organizationId: first.id,
  eventType: "LOGIN_FAILURE",
  outcome: "FAILURE",
  source: "INTEGRATION_TEST",
  sourcePrincipal: "network:192.0.2.5",
  context: {
    reason: "INVALID",
    refreshToken: "must-not-be-stored",
    rawPayload: "must-not-be-stored",
  },
  now,
  emit: (projection) => {
    emitted = JSON.stringify(projection);
  },
});
assert.equal((event.context as { reason: string }).reason, "INVALID");
assert.equal(
  JSON.stringify(event.context).includes("must-not-be-stored"),
  false,
);
assert.equal(emitted.includes("must-not-be-stored"), false);
assert.equal(event.sourcePrincipalHash?.length, 64);
assert.ok(event.retentionUntil >= new Date("2027-08-29T08:00:00Z"));

for (let index = 0; index < 4; index += 1) {
  await recordSecurityAuditEvent({
    organizationId: first.id,
    eventType: "LOGIN_FAILURE",
    outcome: "FAILURE",
    source: "INTEGRATION_TEST",
    context: { reason: "INVALID" },
    now: new Date(now.getTime() + index + 1),
  });
}
const evaluatedSignals = await evaluateSecuritySignals(
  new Date(now.getTime() + 5_000),
);
assert.ok(evaluatedSignals.organizationsEvaluated >= 1);
assert.equal(
  await db.securityAlert.count({
    where: {
      organizationId: first.id,
      alertType: "REPEATED_AUTH_FAILURES",
    },
  }),
  1,
);

await recordSecurityControl({
  organizationId: first.id,
  controlType: "SECURITY_LOG_REVIEW",
  result: "FINDINGS",
  performedAt: now,
  periodStartedAt: new Date("2026-08-15T08:00:00Z"),
  periodEndedAt: now,
  evidenceReference: "private://security/reviews/2026-08-29",
  summary: "Reviewed all expected security log sources.",
  findings: ["One follow-up action"],
  actionItems: [
    {
      owner: "Security owner",
      dueAt: "2026-09-02T08:00:00Z",
      action: "Validate follow-up alert",
    },
  ],
  idempotencyKey: `log-review-${suffix}`,
});
await recordSecurityControl({
  organizationId: first.id,
  controlType: "SECURITY_LOG_REVIEW",
  result: "FINDINGS",
  performedAt: now,
  summary: "Idempotent duplicate review request.",
  idempotencyKey: `log-review-${suffix}`,
});
assert.equal(
  await db.securityControlRecord.count({
    where: { organizationId: first.id, controlType: "SECURITY_LOG_REVIEW" },
  }),
  1,
);

const incident = await createSecurityIncident({
  organizationId: first.id,
  reference: `INC-${suffix}`,
  title: "Bounded integration incident",
  severity: "SEV_2",
  detectedAt: now,
  amazonInformationOrAccessInvolved: true,
  nonSensitiveSummary: "Test record contains no credentials or provider data.",
});
assert.equal(
  incident.amazonNotificationDueAt?.toISOString(),
  "2026-08-30T08:00:00.000Z",
);
const notified = await recordAmazonIncidentNotification({
  organizationId: first.id,
  incidentId: incident.id,
  notifiedAt: new Date("2026-08-29T12:00:00Z"),
  amazonIncidentReference: `AMZ-${suffix}`,
});
assert.equal(
  notified.amazonNotifiedAt?.toISOString(),
  "2026-08-29T12:00:00.000Z",
);

await createSecurityAlert({
  organizationId: first.id,
  alertType: "ACCOUNT_LOCKOUT",
  observedAt: now,
  windowStart: new Date("2026-08-29T07:45:00Z"),
  triggerInputs: { count: 1, threshold: 1 },
});
await createSecurityAlert({
  organizationId: second.id,
  alertType: "ACCOUNT_LOCKOUT",
  observedAt: now,
  windowStart: new Date("2026-08-29T07:45:00Z"),
  triggerInputs: { count: 1, threshold: 1 },
});
const status = await listSecurityOperationsStatus(first.id, now);
assert.deepEqual(status.alerts.map(({ alertType }) => alertType).sort(), [
  "ACCOUNT_LOCKOUT",
  "REPEATED_AUTH_FAILURES",
]);
assert.equal(status.incidents.length, 1);
assert.equal(
  status.controls.find(
    ({ controlType }) => controlType === "SECURITY_LOG_REVIEW",
  )?.overdue,
  false,
);
assert.equal(
  await db.securityAlert.count({ where: { organizationId: second.id } }),
  1,
);
assert.equal(
  await db.securityIncident.count({ where: { organizationId: second.id } }),
  0,
);

console.log(
  JSON.stringify({
    securityOperations: "PASS",
    tenantIsolation: "PASS",
    notificationDeadlineHours: 24,
    logRetentionMonths: 12,
    sensitiveContextRedaction: "PASS",
  }),
);
