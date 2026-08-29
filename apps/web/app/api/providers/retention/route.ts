import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createAmazonDeletionRequest,
  getAmazonRetentionDashboard,
} from "@rizpoint/database";
import { requireSecurityPermission } from "@/src/security/security-principal";

export const runtime = "nodejs";

const requestSchema = z.object({
  reason: z.enum([
    "AMAZON_NOTICE",
    "AUTHORIZATION_REVOKED",
    "ENTITLEMENT_LOST",
    "SERVICE_TERMINATION",
    "OPERATOR_POLICY",
  ]),
  marketplaceId: z.string().trim().min(3).max(32).optional(),
  confirmation: z.literal("DELETE AMAZON INFORMATION"),
  idempotencyKey: z.string().trim().min(12).max(200),
});

/** Returns counts and policy metadata only—never provider payloads, object
 * names, source record IDs, or credentials. */
export async function GET(request: NextRequest) {
  const access = requireSecurityPermission(request, "MANAGE_SECURITY");
  if (access.denied) return access.denied;
  return NextResponse.json(
    await getAmazonRetentionDashboard(access.principal.organizationId),
    { headers: { "cache-control": "no-store" } },
  );
}

/** Destructive, owner/admin-only workflow. Creating the request immediately
 * revokes local live access and places provider work into a safe state; the
 * bounded worker performs the retryable deletion. */
export async function POST(request: NextRequest) {
  const access = requireSecurityPermission(request, "MANAGE_SECURITY");
  if (access.denied) return access.denied;
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "AMAZON_DELETION_REQUEST_INVALID" },
      { status: 400 },
    );
  const result = await createAmazonDeletionRequest({
    organizationId: access.principal.organizationId,
    requestedByUserId: access.principal.userId,
    reason: input.data.reason,
    ...(input.data.marketplaceId
      ? { marketplaceId: input.data.marketplaceId }
      : {}),
    idempotencyKey: input.data.idempotencyKey,
  });
  return NextResponse.json(
    {
      status: result.request.status,
      duplicate: result.duplicate,
      requestedAt: result.request.requestedAt.toISOString(),
      deadlineAt: result.request.deadlineAt.toISOString(),
      safeStateAt: result.request.safeStateAt?.toISOString() ?? null,
    },
    { status: result.duplicate ? 200 : 202 },
  );
}
