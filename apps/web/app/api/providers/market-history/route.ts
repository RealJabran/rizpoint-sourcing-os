import { NextRequest, NextResponse } from "next/server";
import {
  hasActiveProviderCredential,
  listProviderCapabilityStates,
} from "@rizpoint/database";
import type { ProviderCapabilityState } from "@rizpoint/provider-contracts";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

export const runtime = "nodejs";

/** Settings-safe status only: encrypted credential envelopes and raw history
 * observations never cross this boundary. */
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  const mode =
    process.env.MARKET_HISTORY_PROVIDER_MODE === "keepa" ? "LIVE" : "MOCK";
  if (mode === "MOCK") {
    return NextResponse.json({
      provider: "recorded-history",
      mode,
      status: "NOT_CONFIGURED",
      checkedAt: new Date().toISOString(),
      dataOrigin: "RECORDED_FIXTURE",
      configured: false,
      capabilities: [],
      message:
        "Recorded history fixtures are available only in explicit local demo workflows; a licensed provider is required for live history.",
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
    configured,
    dataOrigin: configured ? "LICENSED_PROVIDER" : "NONE",
    capabilities: [state],
  });
}
