import { NextRequest, NextResponse } from "next/server";
import { revokeSession } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const access = requireSecurityPermission(request, "VIEW_RESEARCH");
  if (access.denied) return access.denied;
  try {
    await revokeSession({
      organizationId: access.principal.organizationId,
      userId: access.principal.userId,
      sessionId: (await params).sessionId,
    });
    return NextResponse.json({ status: "SESSION_REVOKED" });
  } catch {
    return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  }
}
