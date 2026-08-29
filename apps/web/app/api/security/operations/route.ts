import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSecurityIncident,
  recordAmazonIncidentNotification,
  recordSecurityControl,
} from "@rizpoint/database";
import { requireSecurityPermission } from "@/src/security/security-principal";

const controlTypes = [
  "SECURITY_LOG_REVIEW",
  "INCIDENT_RESPONSE_PLAN_REVIEW",
  "VULNERABILITY_SCAN",
  "MALWARE_UPDATE_REVIEW",
  "ACCESS_REVIEW",
  "BACKUP_RESTORE_TEST",
  "RISK_ASSESSMENT",
  "PENETRATION_TEST",
  "API_CREDENTIAL_ROTATION",
  "ENCRYPTION_KEY_ROTATION",
  "SECURITY_AWARENESS_TRAINING",
  "THIRD_PARTY_RISK_REVIEW",
] as const;

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RECORD_CONTROL"),
    controlType: z.enum(controlTypes),
    result: z.enum(["PASS", "FAIL", "FINDINGS"]),
    performedAt: z.iso.datetime(),
    periodStartedAt: z.iso.datetime().optional(),
    periodEndedAt: z.iso.datetime().optional(),
    evidenceReference: z.string().trim().max(500).optional(),
    summary: z.string().trim().min(10).max(2_000),
    findings: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    actionItems: z
      .array(
        z.object({
          owner: z.string().trim().min(1).max(100),
          dueAt: z.iso.datetime(),
          action: z.string().trim().min(1).max(500),
        }),
      )
      .max(100)
      .optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }),
  z.object({
    action: z.literal("CREATE_INCIDENT"),
    reference: z.string().trim().min(3).max(100),
    title: z.string().trim().min(3).max(200),
    severity: z.enum(["SEV_1", "SEV_2", "SEV_3", "SEV_4"]),
    detectedAt: z.iso.datetime(),
    amazonInformationOrAccessInvolved: z.boolean(),
    nonSensitiveSummary: z.string().trim().min(10).max(2_000),
  }),
  z.object({
    action: z.literal("RECORD_AMAZON_NOTIFICATION"),
    incidentId: z.string().trim().min(1).max(100),
    notifiedAt: z.iso.datetime(),
    amazonIncidentReference: z.string().trim().min(1).max(200),
  }),
]);

export async function POST(request: NextRequest) {
  const access = requireSecurityPermission(request, "MANAGE_SECURITY");
  if (access.denied) return access.denied;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "SECURITY_OPERATION_INPUT_INVALID" },
      { status: 400 },
    );
  const common = {
    organizationId: access.principal.organizationId,
  };
  if (input.data.action === "RECORD_CONTROL") {
    const record = await recordSecurityControl({
      ...common,
      reviewerUserId: access.principal.userId,
      controlType: input.data.controlType,
      result: input.data.result,
      performedAt: new Date(input.data.performedAt),
      ...(input.data.periodStartedAt
        ? { periodStartedAt: new Date(input.data.periodStartedAt) }
        : {}),
      ...(input.data.periodEndedAt
        ? { periodEndedAt: new Date(input.data.periodEndedAt) }
        : {}),
      ...(input.data.evidenceReference
        ? { evidenceReference: input.data.evidenceReference }
        : {}),
      summary: input.data.summary,
      ...(input.data.findings ? { findings: input.data.findings } : {}),
      ...(input.data.actionItems
        ? { actionItems: input.data.actionItems }
        : {}),
      idempotencyKey: input.data.idempotencyKey,
    });
    return NextResponse.json({ status: "CONTROL_RECORDED", id: record.id });
  }
  if (input.data.action === "CREATE_INCIDENT") {
    const incident = await createSecurityIncident({
      ...common,
      reference: input.data.reference,
      title: input.data.title,
      severity: input.data.severity,
      detectedAt: new Date(input.data.detectedAt),
      amazonInformationOrAccessInvolved:
        input.data.amazonInformationOrAccessInvolved,
      incidentCommanderUserId: access.principal.userId,
      nonSensitiveSummary: input.data.nonSensitiveSummary,
    });
    return NextResponse.json(
      {
        status: "INCIDENT_CREATED",
        id: incident.id,
        amazonNotificationDueAt:
          incident.amazonNotificationDueAt?.toISOString() ?? null,
      },
      { status: 201 },
    );
  }
  const incident = await recordAmazonIncidentNotification({
    ...common,
    incidentId: input.data.incidentId,
    notifiedAt: new Date(input.data.notifiedAt),
    amazonIncidentReference: input.data.amazonIncidentReference,
  });
  return NextResponse.json({
    status: "AMAZON_NOTIFICATION_RECORDED",
    late: Boolean(
      incident.amazonNotificationDueAt &&
      incident.amazonNotifiedAt &&
      incident.amazonNotifiedAt > incident.amazonNotificationDueAt,
    ),
  });
}
