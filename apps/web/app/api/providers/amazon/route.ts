import { NextResponse } from "next/server";
import { publicSpApiConfigurationStatus } from "@rizpoint/amazon-sp-api";
import {
  ensureMockAmazonConnection,
  ensurePhaseZeroOrganization,
  getAmazonProviderConnectionStatus,
  listProviderCapabilityStates,
} from "@rizpoint/database";
import type {
  ProviderCapability,
  ProviderCapabilityState,
  ProviderOperationalState,
} from "@rizpoint/provider-contracts";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

const LIVE_CAPABILITIES: readonly ProviderCapability[] = [
  "CATALOG",
  "COMPETITIVE_OFFERS",
  "FEES",
  "RESTRICTIONS",
];

function aggregateState(
  capabilities: readonly ProviderCapabilityState[],
): ProviderOperationalState {
  const priority: readonly ProviderOperationalState[] = [
    "UNAUTHORIZED",
    "QUOTA_EXHAUSTED",
    "THROTTLED",
    "UNAVAILABLE",
    "PARTIAL",
    "NOT_CONFIGURED",
    "CONFIGURED",
    "AUTHORIZED",
    "HEALTHY",
  ];
  return (
    priority.find((state) =>
      capabilities.some((capability) => capability.state === state),
    ) ?? "NOT_CONFIGURED"
  );
}

function unavailableCapabilities(
  marketplaceId: string,
  checkedAt: string,
): ProviderCapabilityState[] {
  return LIVE_CAPABILITIES.map((capability) => ({
    providerKey: "amazon-sp-api",
    marketplaceId,
    capability,
    mode: "LIVE",
    state: "NOT_CONFIGURED",
    checkedAt,
    reason: "CREDENTIALS_MISSING",
    completeness: "UNKNOWN",
  }));
}

/** This public DTO contains status only; credentials and provider response bodies stay server-side. */
export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const configured = publicSpApiConfigurationStatus();
  const organization = await ensurePhaseZeroOrganization();
  if (configured.mode === "mock") {
    const connection = await ensureMockAmazonConnection(organization.id);
    const capabilities = await listProviderCapabilityStates({
      organizationId: organization.id,
      providerKey: "mock-amazon",
      marketplaceId: connection.marketplaceId,
    });
    return NextResponse.json({
      provider: "mock-amazon",
      mode: "MOCK",
      status: aggregateState(capabilities),
      checkedAt: configured.checkedAt,
      dataOrigin: "MOCK_FIXTURE",
      capabilities,
    });
  }
  if (configured.status === "MISCONFIGURED") {
    const capabilities = unavailableCapabilities(
      process.env.SP_API_MARKETPLACE_ID ?? "ATVPDKIKX0DER",
      configured.checkedAt,
    );
    return NextResponse.json({
      provider: "amazon-sp-api",
      mode: "LIVE",
      status: "NOT_CONFIGURED",
      checkedAt: configured.checkedAt,
      reason: "CREDENTIALS_MISSING",
      capabilities,
    });
  }
  const connection = await getAmazonProviderConnectionStatus(organization.id);
  const checkedAt =
    connection?.lastValidatedAt?.toISOString() ?? new Date().toISOString();
  const capabilities = connection
    ? await listProviderCapabilityStates({
        organizationId: organization.id,
        providerKey: "amazon-sp-api",
        marketplaceId: connection.marketplaceId,
      })
    : unavailableCapabilities(
        process.env.SP_API_MARKETPLACE_ID ?? "ATVPDKIKX0DER",
        checkedAt,
      );
  return NextResponse.json({
    provider: "amazon-sp-api",
    mode: "LIVE",
    status: aggregateState(capabilities),
    checkedAt,
    ...(!connection ? { reason: "CREDENTIALS_MISSING" } : {}),
    ...(connection?.lastErrorCode
      ? { lastErrorCode: connection.lastErrorCode }
      : {}),
    capabilities,
  });
}
