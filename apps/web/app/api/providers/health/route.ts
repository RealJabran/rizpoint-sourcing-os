import { NextRequest, NextResponse } from "next/server";
import { GET as providerStatus } from "../amazon/route";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const statusResponse = await providerStatus(request);
  if (!statusResponse.ok) return statusResponse;
  const health = await statusResponse.json();
  return NextResponse.json(health, {
    status: ["ERROR", "AUTH_REQUIRED", "UNAUTHORIZED"].includes(
      health.connectionState,
    )
      ? 503
      : 200,
  });
}
