import { NextRequest, NextResponse } from "next/server";
import {
  encryptAuthorizationCode,
  hashAuthorizationState,
  readAmazonOAuthPublicConfiguration,
} from "@rizpoint/amazon-sp-api";
import {
  AmazonConnectionError,
  consumeAmazonAuthorizationState,
  failAmazonAuthorizationState,
} from "@rizpoint/database";

export const runtime = "nodejs";

function redirect(request: NextRequest, outcome: string) {
  const url = new URL("/settings/integrations/amazon", request.url);
  url.searchParams.set("authorization", outcome);
  return NextResponse.redirect(url, {
    headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const sellerId = request.nextUrl.searchParams.get("selling_partner_id") ?? "";
  const code = request.nextUrl.searchParams.get("spapi_oauth_code") ?? "";
  if (!state) return redirect(request, "invalid_state");
  const stateHash = hashAuthorizationState(state);
  if (!sellerId || !code) {
    await failAmazonAuthorizationState({
      stateHash,
      failureCode: "OAUTH_CALLBACK_INCOMPLETE",
    }).catch(() => undefined);
    return redirect(request, "failed");
  }
  try {
    const configuration = readAmazonOAuthPublicConfiguration();
    await consumeAmazonAuthorizationState({
      stateHash,
      encryptedOauthCode: encryptAuthorizationCode(
        code,
        configuration.callbackPublicKey,
      ),
      oauthCodeKeyVersion: configuration.callbackKeyVersion,
      sellerId,
    });
    return redirect(request, "processing");
  } catch (error) {
    const outcome =
      error instanceof AmazonConnectionError
        ? error.code.toLowerCase()
        : "failed";
    return redirect(request, outcome);
  }
}
