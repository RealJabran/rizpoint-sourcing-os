import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
import {
  LwaAccessTokenProvider,
  SpApiTransport,
  publicSpApiConfigurationStatus,
  readSpApiConfig,
  readSpApiConnectionConfig,
  redactSpApiHeaders,
  redactSpApiPayload,
  redactSpApiUrl,
  testSpApiConnection,
} from "../src/index.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  endpoint: "https://sellingpartnerapi-na.amazon.com",
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("SP-API configuration", () => {
  it("defaults to mock and validates only allowlisted live endpoints", () => {
    expect(publicSpApiConfigurationStatus({})).toMatchObject({
      mode: "mock",
      status: "MOCK",
    });
    expect(() =>
      readSpApiConfig({
        PROVIDER_MODE: "sp_api",
        SP_API_LWA_CLIENT_ID: "client-id",
        SP_API_LWA_CLIENT_SECRET: "client-secret",
        SP_API_ENDPOINT: "https://example.invalid",
      }),
    ).toThrow("INVALID_ENDPOINT");
    expect(
      readSpApiConfig({
        PROVIDER_MODE: "sp_api",
        SP_API_LWA_CLIENT_ID: "client-id",
        SP_API_LWA_CLIENT_SECRET: "client-secret",
        SP_API_ENDPOINT: config.endpoint,
      }),
    ).toEqual(config);
    // The status DTO is safe for the web process, which intentionally lacks
    // the worker-only LWA client secret.
    expect(
      publicSpApiConfigurationStatus({
        PROVIDER_MODE: "sp_api",
        SP_API_ENDPOINT: config.endpoint,
      }),
    ).toMatchObject({ mode: "sp_api", status: "UNAVAILABLE" });
  });

  it("requires server-only connection inputs for an opt-in smoke check", () => {
    const environment = {
      SP_API_LWA_CLIENT_ID: config.clientId,
      SP_API_LWA_CLIENT_SECRET: config.clientSecret,
      SP_API_ENDPOINT: config.endpoint,
    };
    expect(() => readSpApiConnectionConfig(environment)).toThrow(
      "MISSING_CONFIGURATION",
    );
    expect(
      readSpApiConnectionConfig({
        ...environment,
        SP_API_MARKETPLACE_ID: "ATVPDKIKX0DER",
        SP_API_SELLER_ID: "seller-id",
        SP_API_REFRESH_TOKEN: "refresh-token",
      }),
    ).toMatchObject({ region: "NA", marketplaceId: "ATVPDKIKX0DER" });
  });
});

describe("SP-API redaction", () => {
  it("redacts credentials from headers, URLs, and provider-shaped payloads", () => {
    expect(
      redactSpApiHeaders({
        authorization: "Bearer Atza|access-token",
        "x-amz-access-token": "Atza|access-token",
        accept: "application/json",
      }),
    ).toEqual({
      accept: "application/json",
      authorization: "[REDACTED]",
      "x-amz-access-token": "[REDACTED]",
    });
    expect(
      redactSpApiUrl(
        "https://example.test/callback?refresh_token=Atzr%7Ctoken&safe=value",
      ),
    ).toContain("refresh_token=%5BREDACTED%5D&safe=value");
    expect(
      redactSpApiPayload({
        access_token: "Atza|access-token",
        nested: { client_secret: "secret", visible: "safe" },
      }),
    ).toEqual({
      access_token: "[REDACTED]",
      nested: { client_secret: "[REDACTED]", visible: "safe" },
    });
  });
});

describe("LWA access-token cache", () => {
  it("deduplicates concurrent exchanges and refreshes only after the safe lifetime", async () => {
    let now = 0;
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ access_token: "Atza|short-lived", expires_in: 3600 }),
    );
    const tokens = new LwaAccessTokenProvider(
      config,
      "Atzr|refresh-token",
      fetchImplementation,
      () => now,
    );

    await expect(
      Promise.all([
        tokens.getAccessToken(),
        tokens.getAccessToken(),
        tokens.getAccessToken(),
      ]),
    ).resolves.toEqual([
      "Atza|short-lived",
      "Atza|short-lived",
      "Atza|short-lived",
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    now = 3_500_000;
    await tokens.getAccessToken();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    now = 3_550_000;
    await tokens.getAccessToken();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});

describe("SP-API transport", () => {
  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [429, "THROTTLED"],
    [500, "PROVIDER_OUTAGE"],
  ] as const)(
    "maps HTTP %i to %s without exposing a response body",
    async (status, code) => {
      const transport = new SpApiTransport(
        config,
        async () => "Atza|access-token",
        async () =>
          jsonResponse({ refresh_token: "never-expose" }, status, {
            "retry-after": "3",
          }),
      );
      await expect(
        transport.request("/sellers/v1/marketplaceParticipations"),
      ).rejects.toMatchObject({
        code,
        options: expect.objectContaining({ httpStatus: status }),
      } satisfies Partial<ProviderError>);
    },
  );

  it("reads an available rate-limit header but succeeds when it is absent", async () => {
    const withLimit = new SpApiTransport(
      config,
      async () => "Atza|access-token",
      async () => jsonResponse({}, 200, { "x-amzn-ratelimit-limit": "0.5" }),
    );
    await expect(
      withLimit.request("/sellers/v1/marketplaceParticipations"),
    ).resolves.toMatchObject({
      rateLimitPerSecond: 0.5,
    });
    const withoutLimit = new SpApiTransport(
      config,
      async () => "Atza|access-token",
      async () => jsonResponse({}),
    );
    await expect(
      withoutLimit.request("/sellers/v1/marketplaceParticipations"),
    ).resolves.not.toHaveProperty("rateLimitPerSecond");
  });

  it("reports a sanitized public connection status for an unauthorized probe", async () => {
    const health = await testSpApiConnection(
      new SpApiTransport(
        config,
        async () => "Atza|access-token",
        async () => jsonResponse({ access_token: "never-expose" }, 401),
      ),
    );
    expect(health).toMatchObject({
      status: "UNAUTHORIZED",
      lastErrorCode: "UNAUTHORIZED",
    });
    expect(JSON.stringify(health)).not.toContain("never-expose");
  });

  it("reports throttled validation without replacing prior data with zeros", async () => {
    const health = await testSpApiConnection(
      new SpApiTransport(
        config,
        async () => "Atza|access-token",
        async () => jsonResponse({ errors: [] }, 429),
      ),
    );
    expect(health).toMatchObject({
      status: "THROTTLED",
      lastErrorCode: "THROTTLED",
    });
    expect(health).not.toHaveProperty("marketplaces");
  });
});
