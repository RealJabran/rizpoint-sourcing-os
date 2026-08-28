import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { changeOwnPassword } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

const schema = z.object({
  currentPassword: z.string().min(1).max(1_024),
  newPassword: z.string().min(1).max(1_024),
});

export async function POST(request: NextRequest) {
  const access = requireSecurityPermission(request, "VIEW_RESEARCH");
  if (access.denied) return access.denied;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "PASSWORD_CHANGE_INVALID" },
      { status: 400 },
    );
  try {
    await changeOwnPassword({
      organizationId: access.principal.organizationId,
      userId: access.principal.userId,
      ...input.data,
    });
    return NextResponse.json({ status: "PASSWORD_CHANGED" });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "PASSWORD_CHANGE_INVALID";
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
