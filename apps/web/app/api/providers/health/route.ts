import { NextResponse } from "next/server";
import { GET as providerStatus } from "../amazon/route";

export const runtime = "nodejs";

export async function GET() {
  const statusResponse = await providerStatus();
  if (!statusResponse.ok) return statusResponse;
  const health = await statusResponse.json();
  return NextResponse.json(health, {
    status: health.status === "UNAVAILABLE" ? 503 : 200,
  });
}
