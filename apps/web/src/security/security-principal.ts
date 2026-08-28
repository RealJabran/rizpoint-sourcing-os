import { NextRequest, NextResponse } from "next/server";
import type { OrganizationRole } from "@rizpoint/database";
import { roleHasPermission, type SecurityPermission } from "./authorization";

const roles = new Set<OrganizationRole>([
  "OWNER",
  "ADMIN",
  "RESEARCHER",
  "VIEWER",
]);

export type SecurityPrincipal = {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
};

export function securityPrincipalForRequest(
  request: NextRequest,
): SecurityPrincipal | null {
  const organizationId = request.headers.get("x-rizpoint-organization-id");
  const userId = request.headers.get("x-rizpoint-user-id");
  const role = request.headers.get(
    "x-rizpoint-role",
  ) as OrganizationRole | null;
  if (!organizationId || !userId || !role || !roles.has(role)) return null;
  return { organizationId, userId, role };
}

export function requireSecurityPermission(
  request: NextRequest,
  permission: SecurityPermission,
):
  | { principal: SecurityPrincipal; denied: null }
  | {
      principal: null;
      denied: NextResponse;
    } {
  const principal = securityPrincipalForRequest(request);
  if (!principal)
    return {
      principal: null,
      denied: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }),
    };
  if (!roleHasPermission(principal.role, permission))
    return {
      principal: null,
      denied: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }),
    };
  return { principal, denied: null };
}
