import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listProviderCapabilityStates,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  const capabilities = await listProviderCapabilityStates({
    organizationId: organization.id,
  });
  const advertising = capabilities.filter(
    (capability) => capability.capability === "AD_INTELLIGENCE",
  );
  return NextResponse.json({
    capabilities: advertising,
    observations: [],
    reason: advertising.some((item) => item.state === "HEALTHY")
      ? "NO_AUTHORIZED_AD_OBSERVATIONS"
      : "ADVERTISING_PROVIDER_NOT_CONFIGURED",
  });
}
