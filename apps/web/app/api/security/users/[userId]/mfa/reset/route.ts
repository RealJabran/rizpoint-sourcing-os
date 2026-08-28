import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetUserMfa } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

const schema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const access = requireSecurityPermission(request, "MANAGE_SECURITY");
  if (access.denied) return access.denied;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "REASON_REQUIRED" }, { status: 400 });
  try {
    await resetUserMfa({
      organizationId: access.principal.organizationId,
      actorUserId: access.principal.userId,
      userId: (await params).userId,
      reason: input.data.reason,
    });
    return NextResponse.json({ status: "MFA_RESET" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MFA_RESET_FAILED";
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
