import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordCredentialRotation } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

const schema = z.object({
  credentialType: z.enum([
    "SP_API_LWA_CLIENT_SECRET",
    "SP_API_REFRESH_TOKEN",
    "PROVIDER_ENCRYPTION_KEY",
    "MFA_ENCRYPTION_KEY",
  ]),
  keyVersion: z.number().int().positive().optional(),
  notes: z.string().trim().max(1_000).optional(),
});

export async function POST(request: NextRequest) {
  const access = requireSecurityPermission(
    request,
    "MANAGE_PROVIDER_CREDENTIALS",
  );
  if (access.denied) return access.denied;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "ROTATION_INPUT_INVALID" },
      { status: 400 },
    );
  await recordCredentialRotation({
    organizationId: access.principal.organizationId,
    actorUserId: access.principal.userId,
    credentialType: input.data.credentialType,
    ...(input.data.keyVersion ? { keyVersion: input.data.keyVersion } : {}),
    ...(input.data.notes ? { notes: input.data.notes } : {}),
  });
  return NextResponse.json({ status: "CREDENTIAL_ROTATION_RECORDED" });
}
