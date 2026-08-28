import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetExpiredPassword } from "@/src/security/authentication";

export const runtime = "nodejs";

const inputSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  password: z.string().min(1).max(1_024),
});

const publicErrors = new Set([
  "PASSWORD_TOO_SHORT",
  "PASSWORD_UPPERCASE_REQUIRED",
  "PASSWORD_LOWERCASE_REQUIRED",
  "PASSWORD_NUMBER_REQUIRED",
  "PASSWORD_SPECIAL_REQUIRED",
  "PASSWORD_CONTAINS_IDENTITY",
  "PASSWORD_REUSED",
  "PASSWORD_MINIMUM_AGE",
]);

export async function POST(request: NextRequest) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "PASSWORD_RESET_INVALID" },
      { status: 400 },
    );
  try {
    return NextResponse.json(await resetExpiredPassword(input.data), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "PASSWORD_RESET_INVALID";
    return NextResponse.json(
      { error: publicErrors.has(code) ? code : "PASSWORD_RESET_INVALID" },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
}
