import { db, ensurePhaseZeroOrganization } from "@rizpoint/database";
import type { NextRequest } from "next/server";

/** The production proxy injects this header only after validating a signed
 * membership. Local demo remains pinned to the seeded phase-zero tenant. */
export async function organizationForRequest(request: NextRequest) {
  const organizationId = request.headers.get("x-rizpoint-organization-id");
  if (!organizationId) return ensurePhaseZeroOrganization();
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, slug: true, name: true },
  });
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
  return organization;
}
