import { NextRequest, NextResponse } from "next/server";
import { roleHasPermission } from "@/src/security/authorization";
import { getSecurityDashboard } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = requireSecurityPermission(request, "VIEW_RESEARCH");
  if (access.denied) return access.denied;
  const result = await getSecurityDashboard({
    organizationId: access.principal.organizationId,
    userId: access.principal.userId,
    includeOrganization: roleHasPermission(
      access.principal.role,
      "MANAGE_SECURITY",
    ),
  });
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
