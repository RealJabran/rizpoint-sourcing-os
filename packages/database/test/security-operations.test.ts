import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  AMAZON_INCIDENT_NOTIFICATION_HOURS,
  hashSecurityPrincipal,
  sanitizeSecurityContext,
  SECURITY_ALERT_CATALOG,
  SECURITY_CONTROL_MAX_AGE_DAYS,
  SECURITY_LOG_RETENTION_MONTHS,
  securityEventLogProjection,
} from "../src/security-operations.js";

describe("Amazon security operations policy", () => {
  it("sanitizes security context and never projects credentials or payloads", () => {
    expect(
      sanitizeSecurityContext({
        reason: "PASSWORD_INVALID",
        count: 5,
        refreshToken: "must-not-appear",
        rawPayload: "must-not-appear",
        password: "must-not-appear",
      }),
    ).toEqual({ reason: "PASSWORD_INVALID", count: 5 });
    const projection = securityEventLogProjection({
      timestamp: new Date("2026-08-29T00:00:00Z"),
      organizationId: "org-a",
      eventType: "LOGIN_FAILURE",
      outcome: "FAILURE",
      source: "AUTHENTICATION",
      context: { token: "secret", reason: "INVALID" },
    });
    expect(JSON.stringify(projection)).not.toContain("secret");
    expect(projection.context).toEqual({ reason: "INVALID" });
  });

  it("uses stable one-way source principal hashes", () => {
    expect(hashSecurityPrincipal("network:192.0.2.1")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(hashSecurityPrincipal("network:192.0.2.1")).toBe(
      hashSecurityPrincipal("network:192.0.2.1"),
    );
    expect(hashSecurityPrincipal("network:192.0.2.1")).not.toContain(
      "192.0.2.1",
    );
  });

  it("defines every required alert and maintenance deadline", () => {
    expect(SECURITY_LOG_RETENTION_MONTHS).toBe(12);
    expect(AMAZON_INCIDENT_NOTIFICATION_HOURS).toBe(24);
    expect(Object.keys(SECURITY_ALERT_CATALOG)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(SECURITY_CONTROL_MAX_AGE_DAYS.SECURITY_LOG_REVIEW).toBe(14);
    expect(SECURITY_CONTROL_MAX_AGE_DAYS.VULNERABILITY_SCAN).toBe(30);
    expect(
      SECURITY_CONTROL_MAX_AGE_DAYS.BACKUP_RESTORE_TEST,
    ).toBeLessThanOrEqual(92);
    expect(
      SECURITY_CONTROL_MAX_AGE_DAYS.INCIDENT_RESPONSE_PLAN_REVIEW,
    ).toBeLessThanOrEqual(183);
    expect(SECURITY_CONTROL_MAX_AGE_DAYS.PENETRATION_TEST).toBeLessThanOrEqual(
      365,
    );
  });

  it("ships tenant-scoped reversible incident, alert, and review storage", async () => {
    const [schema, migration, rollback] = await Promise.all([
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../prisma/migrations/20260829090000_amazon_security_operations/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../prisma/migrations/20260829090000_amazon_security_operations/rollback.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    for (const model of [
      "SecurityControlRecord",
      "SecurityAlert",
      "SecurityIncident",
    ])
      expect(schema).toContain(`model ${model}`);
    expect(migration).toContain("INTERVAL '12 months'");
    expect(migration).toContain(
      'FOREIGN KEY ("organization_id")\n    REFERENCES "organizations"',
    );
    expect(migration).toContain("security_control_records_due_check");
    expect(rollback).toContain('DROP TABLE IF EXISTS "security_incidents"');
    expect(rollback).toContain('DROP TYPE IF EXISTS "SecurityEventOutcome"');
  });
});
