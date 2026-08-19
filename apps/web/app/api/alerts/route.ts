import { NextRequest, NextResponse } from "next/server";
import {
  acknowledgeAlertNotification,
  ensurePhaseZeroOrganization,
  listAlertNotifications,
  researchRepository,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  return NextResponse.json(
    await listAlertNotifications((await ensurePhaseZeroOrganization()).id),
  );
}
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  try {
    const org = await ensurePhaseZeroOrganization();
    if (body?.action === "acknowledge")
      return NextResponse.json(
        await acknowledgeAlertNotification(org.id, String(body.id ?? "")),
      );
    return NextResponse.json(
      await researchRepository.createAlertRule({
        organizationId: org.id,
        ...(typeof body?.projectId === "string"
          ? { projectId: body.projectId }
          : {}),
        marketplaceId: String(body?.marketplaceId ?? ""),
        subjectType: String(body?.subjectType ?? "") as never,
        subjectKey: String(body?.subjectKey ?? ""),
        metricKey: String(body?.metricKey ?? ""),
        operator: String(body?.operator ?? "") as never,
        ...(typeof body?.threshold === "string"
          ? { threshold: body.threshold }
          : {}),
        ...(typeof body?.cooldownMinutes === "number"
          ? { cooldownMinutes: body.cooldownMinutes }
          : {}),
      }),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "ALERT_REQUEST_FAILED",
      },
      { status: 400 },
    );
  }
}
