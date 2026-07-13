import { NextResponse } from "next/server";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

/** OAuth is intentionally configuration-gated. Refresh tokens never reach this route's response. */
export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    provider: "amazon-sp-api",
    configured: Boolean(
      process.env.SP_API_LWA_CLIENT_ID && process.env.SP_API_LWA_CLIENT_SECRET,
    ),
    mode: process.env.PROVIDER_MODE ?? "mock",
    oauth: "server-side-only",
  });
}
