import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SpApiTransport,
  buildAmazonAuthorizationUrl,
  buildAmazonAuthorizationConfirmationUrl,
  createAuthorizationState,
  decryptAuthorizationCode,
  encryptAuthorizationCode,
  exchangeAuthorizationCode,
  getMarketplaceParticipations,
  hashAuthorizationState,
} from "../src/index.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  endpoint: "https://sellingpartnerapi-na.amazon.com",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Amazon website authorization", () => {
  it("creates a high-entropy state while persisting only its hash", () => {
    const first = createAuthorizationState();
    const second = createAuthorizationState();
    expect(first.state).not.toBe(second.state);
    expect(first.state.length).toBeGreaterThanOrEqual(40);
    expect(first.stateHash).toBe(hashAuthorizationState(first.state));
    expect(first.stateHash).not.toContain(first.state);
  });

  it("uses only Amazon's documented consent parameters", () => {
    const result = new URL(
      buildAmazonAuthorizationUrl({
        sellerCentralUrl: "https://sellercentral.amazon.com",
        applicationId: "amzn1.sellerapps.app.fixture",
        state: "csrf-state",
        draft: true,
      }),
    );
    expect(result.pathname).toBe("/apps/authorize/consent");
    expect(Object.fromEntries(result.searchParams)).toEqual({
      application_id: "amzn1.sellerapps.app.fixture",
      state: "csrf-state",
      version: "beta",
    });
  });

  it("allows only an Amazon confirmation URI and documented return parameters", () => {
    const result = new URL(
      buildAmazonAuthorizationConfirmationUrl({
        amazonCallbackUri:
          "https://amazon.com/apps/authorize/confirm/app-fixture?discard=me",
        amazonState: "amazon-csrf",
        state: "rizpoint-csrf",
        redirectUri: "https://app.example/api/providers/amazon/oauth/callback",
        draft: false,
      }),
    );
    expect(Object.fromEntries(result.searchParams)).toEqual({
      redirect_uri: "https://app.example/api/providers/amazon/oauth/callback",
      amazon_state: "amazon-csrf",
      state: "rizpoint-csrf",
    });
    expect(() =>
      buildAmazonAuthorizationConfirmationUrl({
        amazonCallbackUri: "https://attacker.example/apps/authorize/confirm/a",
        amazonState: "state",
        state: "state",
        redirectUri: "https://app.example/callback",
        draft: false,
      }),
    ).toThrow("AMAZON_CALLBACK_URI_INVALID");
  });

  it("encrypts the callback code for the worker private key", () => {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const encrypted = encryptAuthorizationCode(
      "spapi-oauth-code",
      pair.publicKey,
    );
    expect(encrypted).not.toContain("spapi-oauth-code");
    expect(decryptAuthorizationCode(encrypted, pair.privateKey)).toBe(
      "spapi-oauth-code",
    );
  });

  it("exchanges the authorization code with the documented LWA form", async () => {
    const fetchImplementation = vi.fn(async (_url, init) => {
      const form = new URLSearchParams(String(init?.body));
      expect(Object.fromEntries(form)).toEqual({
        grant_type: "authorization_code",
        code: "one-time-code",
        redirect_uri: "https://app.example/api/providers/amazon/oauth/callback",
        client_id: "client-id",
        client_secret: "client-secret",
      });
      return jsonResponse({
        access_token: "short-lived-access",
        refresh_token: "long-lived-refresh",
        token_type: "bearer",
        expires_in: 3600,
      });
    });
    await expect(
      exchangeAuthorizationCode(
        config,
        "one-time-code",
        "https://app.example/api/providers/amazon/oauth/callback",
        fetchImplementation,
      ),
    ).resolves.toEqual({
      accessToken: "short-lived-access",
      refreshToken: "long-lived-refresh",
      expiresInSeconds: 3600,
    });
  });
});

describe("Sellers marketplace discovery", () => {
  it("normalizes marketplace participations without returning a raw payload", async () => {
    const transport = new SpApiTransport(
      config,
      async () => "short-lived-access",
      async () =>
        jsonResponse({
          payload: [
            {
              marketplace: {
                id: "ATVPDKIKX0DER",
                name: "Amazon.com",
                countryCode: "US",
                defaultCurrencyCode: "USD",
                defaultLanguageCode: "en_US",
                domainName: "www.amazon.com",
              },
              participation: {
                isParticipating: true,
                hasSuspendedListings: false,
              },
            },
          ],
        }),
      () => new Date("2026-08-22T00:00:00.000Z"),
    );
    const result = await getMarketplaceParticipations(transport);
    expect(result).toEqual({
      observedAt: "2026-08-22T00:00:00.000Z",
      participations: [
        {
          marketplaceId: "ATVPDKIKX0DER",
          name: "Amazon.com",
          countryCode: "US",
          defaultCurrencyCode: "USD",
          defaultLanguageCode: "en_US",
          domainName: "www.amazon.com",
          isParticipating: true,
          hasSuspendedListings: false,
        },
      ],
    });
    expect(result).not.toHaveProperty("body");
  });
});
