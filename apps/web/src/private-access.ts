import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { phaseZeroDemoEnabled } from "./phase-zero";

/**
 * Phase 6 remains a private demo workflow. Production requests must carry a
 * server-configured access token until identity-aware organization membership
 * replaces this boundary in Phase 7.
 */
export function requirePrivateAccess(
  request: NextRequest,
): NextResponse | null {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const expected = process.env.RIZPOINT_PRIVATE_ACCESS_TOKEN;
  if (!expected) {
    if (
      process.env.NODE_ENV === "test" ||
      process.env.RIZPOINT_ALLOW_UNAUTHENTICATED_DEMO === "true"
    )
      return null;
    return NextResponse.json(
      { error: "PRIVATE_ACCESS_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.cookies.get("rizpoint_private_access")?.value;
  if (!supplied || supplied.length !== expected.length)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return null;
}
