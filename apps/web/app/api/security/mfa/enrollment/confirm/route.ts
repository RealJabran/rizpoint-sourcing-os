import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmMfaEnrollment } from "@/src/security/authentication";

export const runtime = "nodejs";

const inputSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: z.string().regex(/^\d{6}$/u),
});

export async function POST(request: NextRequest) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "MFA_CODE_INVALID" }, { status: 400 });
  try {
    const result = await confirmMfaEnrollment(input.data);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "MFA_CODE_INVALID" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
}
