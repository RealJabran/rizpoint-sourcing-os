import { NextRequest, NextResponse } from "next/server";
import {
  buildAmazonAuthorizationConfirmationUrl,
  createAuthorizationState,
  readAmazonOAuthPublicConfiguration,
} from "@rizpoint/amazon-sp-api";
import { continueAmazonAuthorizationState } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const amazonCallbackUri =
    request.nextUrl.searchParams.get("amazon_callback_uri") ?? "";
  const amazonState = request.nextUrl.searchParams.get("amazon_state") ?? "";
  const sellerId = request.nextUrl.searchParams.get("selling_partner_id") ?? "";
  if (!amazonCallbackUri || !amazonState || !sellerId)
    return NextResponse.json(
      { error: "OAUTH_LOGIN_REQUEST_INVALID" },
      { status: 400 },
    );
  try {
    const organization = await organizationForRequest(request);
    const configuration = readAmazonOAuthPublicConfiguration();
    const state = createAuthorizationState();
    await continueAmazonAuthorizationState({
      organizationId: organization.id,
      stateHash: state.stateHash,
      sellerId,
    });
    return NextResponse.redirect(
      buildAmazonAuthorizationConfirmationUrl({
        amazonCallbackUri,
        amazonState,
        state: state.state,
        redirectUri: configuration.redirectUri,
        draft:
          configuration.draft ||
          request.nextUrl.searchParams.get("version") === "beta",
      }),
      {
        headers: {
          "referrer-policy": "no-referrer",
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "OAUTH_LOGIN_REQUEST_REJECTED" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
