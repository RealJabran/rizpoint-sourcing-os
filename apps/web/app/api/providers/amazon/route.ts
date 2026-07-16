import { NextResponse } from "next/server";
import {
  providerMode,
  publicSpApiConfigurationStatus,
} from "@rizpoint/amazon-sp-api";
import {
  ensurePhaseZeroOrganization,
  getAmazonProviderConnectionStatus,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

/** This public DTO contains status only; credentials and provider response bodies stay server-side. */
export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const configured = publicSpApiConfigurationStatus();
  if (configured.mode === "mock" || configured.status === "MISCONFIGURED")
    return NextResponse.json(configured);
  const organization = await ensurePhaseZeroOrganization();
  const connection = await getAmazonProviderConnectionStatus(organization.id);
  const checkedAt =
    connection?.lastValidatedAt?.toISOString() ?? new Date().toISOString();
  const status = !connection
    ? "MISCONFIGURED"
    : connection.status === "ACTIVE" && connection.lastSuccessAt
      ? "CONNECTED"
      : connection.status === "AUTH_REQUIRED" || connection.status === "REVOKED"
        ? "UNAUTHORIZED"
        : connection.lastErrorCode === "THROTTLED"
          ? "THROTTLED"
          : "UNAVAILABLE";
  return NextResponse.json({
    provider: "amazon-sp-api",
    mode: providerMode(),
    status,
    checkedAt,
    ...(connection?.lastErrorCode
      ? { lastErrorCode: connection.lastErrorCode }
      : {}),
  });
}
