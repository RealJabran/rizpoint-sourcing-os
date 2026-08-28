import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createOrganizationUser } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

const schema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(["OWNER", "ADMIN", "RESEARCHER", "VIEWER"]),
  temporaryPassword: z.string().min(1).max(1_024),
});

export async function POST(request: NextRequest) {
  const access = requireSecurityPermission(request, "MANAGE_USERS");
  if (access.denied) return access.denied;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "USER_INPUT_INVALID" }, { status: 400 });
  try {
    const user = await createOrganizationUser({
      organizationId: access.principal.organizationId,
      actorUserId: access.principal.userId,
      ...input.data,
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "USER_CREATE_FAILED";
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
