import { NextRequest, NextResponse } from "next/server";
import { getAmazonIntegrationStatus, MARKETPLACES } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  const connection = await getAmazonIntegrationStatus(organization.id);
  const connectedMarketplaces = connection?.marketplaces.filter(
    (item) => item.isParticipating,
  );
  const available = connectedMarketplaces?.length
    ? connectedMarketplaces.flatMap((participation) => {
        const registered = MARKETPLACES.find(
          (marketplace) => marketplace.id === participation.marketplaceId,
        );
        return registered
          ? [
              {
                ...registered,
                label: `${registered.locale} · ${registered.domain}`,
                isDefault: participation.isDefault,
              },
            ]
          : [];
      })
    : MARKETPLACES.map((marketplace) => ({
        ...marketplace,
        label: `${marketplace.locale} · ${marketplace.domain}`,
        isDefault: marketplace.id === "ATVPDKIKX0DER",
      }));
  return NextResponse.json({
    marketplaces: available,
    source: connectedMarketplaces?.length
      ? "AMAZON_MARKETPLACE_PARTICIPATIONS"
      : "RIZPOINT_REGISTRY",
    notice:
      "Capabilities are marketplace-specific. Cross-market metrics require explicit currency/definition normalization.",
  });
}
