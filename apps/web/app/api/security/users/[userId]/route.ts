import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deactivateOrganizationUser } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

const schema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const access = requireSecurityPermission(request, "MANAGE_USERS");
  if (access.denied) return access.denied;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "REASON_REQUIRED" }, { status: 400 });
  try {
    await deactivateOrganizationUser({
      organizationId: access.principal.organizationId,
      actorUserId: access.principal.userId,
      userId: (await params).userId,
      reason: input.data.reason,
    });
    return NextResponse.json({ status: "USER_DISABLED" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "USER_DISABLE_FAILED";
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
