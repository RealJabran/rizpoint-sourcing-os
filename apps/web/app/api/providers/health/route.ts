import { NextResponse } from "next/server";
import { MockAmazonProvider } from "@rizpoint/mock-providers";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((process.env.PROVIDER_MODE ?? "mock") !== "mock")
    return NextResponse.json(
      {
        provider: "amazon-sp-api",
        status: "UNAVAILABLE",
        checkedAt: new Date().toISOString(),
        lastErrorCode: "CONNECTION_NOT_AUTHORIZED",
      },
      { status: 503 },
    );
  return NextResponse.json(await new MockAmazonProvider().health());
}
