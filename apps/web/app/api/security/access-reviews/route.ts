import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAccessReview } from "@/src/security/security-management";
import { requireSecurityPermission } from "@/src/security/security-principal";

const schema = z
  .object({
    subjectUserId: z.string().min(1).max(128),
    decision: z.enum(["APPROVED", "REMOVE_ACCESS", "CHANGE_ROLE"]),
    requestedRole: z
      .enum(["OWNER", "ADMIN", "RESEARCHER", "VIEWER"])
      .optional(),
    reason: z.string().trim().min(3).max(1_000),
  })
  .refine(
    (value) => value.decision !== "CHANGE_ROLE" || Boolean(value.requestedRole),
    { message: "REQUESTED_ROLE_REQUIRED" },
  );

export async function POST(request: NextRequest) {
  const access = requireSecurityPermission(request, "MANAGE_SECURITY");
  if (access.denied) return access.denied;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "ACCESS_REVIEW_INVALID" },
      { status: 400 },
    );
  try {
    await recordAccessReview({
      organizationId: access.principal.organizationId,
      reviewerUserId: access.principal.userId,
      subjectUserId: input.data.subjectUserId,
      decision: input.data.decision,
      reason: input.data.reason,
      ...(input.data.requestedRole
        ? { requestedRole: input.data.requestedRole }
        : {}),
    });
    return NextResponse.json({ status: "ACCESS_REVIEW_COMPLETED" });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "ACCESS_REVIEW_FAILED";
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
