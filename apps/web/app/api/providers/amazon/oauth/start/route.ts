import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AMAZON_MARKETPLACE_REGIONS,
  AMAZON_SELLER_CENTRAL_URLS,
  buildAmazonAuthorizationUrl,
  createAuthorizationState,
  readAmazonOAuthPublicConfiguration,
} from "@rizpoint/amazon-sp-api";
import { createAmazonAuthorizationState } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

export const runtime = "nodejs";

const inputSchema = z.object({ marketplaceId: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  let configuration: ReturnType<typeof readAmazonOAuthPublicConfiguration>;
  try {
    configuration = readAmazonOAuthPublicConfiguration();
  } catch {
    return NextResponse.json(
      { error: "OAUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const sellerCentralUrl =
    AMAZON_SELLER_CENTRAL_URLS[parsed.data.marketplaceId];
  const region = AMAZON_MARKETPLACE_REGIONS[parsed.data.marketplaceId];
  if (!sellerCentralUrl || !region)
    return NextResponse.json(
      { error: "MARKETPLACE_NOT_SUPPORTED" },
      { status: 400 },
    );
  const organization = await organizationForRequest(request);
  const state = createAuthorizationState();
  await createAmazonAuthorizationState({
    organizationId: organization.id,
    stateHash: state.stateHash,
    marketplaceId: parsed.data.marketplaceId,
    region,
    returnPath: "/settings/integrations/amazon",
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return NextResponse.json(
    {
      authorizationUrl: buildAmazonAuthorizationUrl({
        sellerCentralUrl,
        applicationId: configuration.applicationId,
        state: state.state,
        draft: configuration.draft,
      }),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
