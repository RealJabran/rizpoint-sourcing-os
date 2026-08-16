import { NextResponse } from "next/server";
import {
  ensureMockAmazonConnection,
  ensurePhaseZeroOrganization,
  hasActiveProviderCredential,
  listProviderCapabilityStates,
} from "@rizpoint/database";
import type { ProviderCapabilityState } from "@rizpoint/provider-contracts";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

/** Settings-safe status only: encrypted credential envelopes and raw history
 * observations never cross this boundary. */
export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const mode =
    process.env.MARKET_HISTORY_PROVIDER_MODE === "keepa" ? "LIVE" : "MOCK";
  if (mode === "MOCK") {
    const connection = await ensureMockAmazonConnection(organization.id);
    const capabilities = await listProviderCapabilityStates({
      organizationId: organization.id,
      providerKey: "mock-amazon",
      marketplaceId: connection.marketplaceId,
    });
    return NextResponse.json({
      provider: "recorded-history",
      mode,
      status: "HEALTHY",
      checkedAt: new Date().toISOString(),
      dataOrigin: "RECORDED_FIXTURE",
      capabilities: capabilities.filter(
        (item) => item.capability === "MARKET_HISTORY",
      ),
    });
  }
  const configured = await hasActiveProviderCredential({
    organizationId: organization.id,
    providerKey: "keepa",
    credentialName: "api_key",
  });
  const marketplaceId = process.env.SP_API_MARKETPLACE_ID ?? "ATVPDKIKX0DER";
  const persisted = await listProviderCapabilityStates({
    organizationId: organization.id,
    providerKey: "keepa",
    marketplaceId,
  });
  const state: ProviderCapabilityState = persisted.find(
    (item) => item.capability === "MARKET_HISTORY",
  ) ?? {
    providerKey: "keepa",
    marketplaceId,
    capability: "MARKET_HISTORY",
    mode,
    state: configured ? "CONFIGURED" : "NOT_CONFIGURED",
    checkedAt: new Date().toISOString(),
    ...(configured ? {} : { reason: "CREDENTIALS_MISSING" as const }),
    completeness: "UNKNOWN",
  };
  return NextResponse.json({
    provider: "keepa",
    mode,
    status: state.state,
    checkedAt: state.checkedAt,
    capabilities: [state],
  });
}
