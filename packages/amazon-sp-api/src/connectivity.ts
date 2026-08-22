import { ProviderError } from "@rizpoint/provider-contracts";
import { z } from "zod";

export const SP_API_ENDPOINTS = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
} as const;

export type SpApiRegion = keyof typeof SP_API_ENDPOINTS;
export type ProviderMode = "mock" | "sp_api";

export type SpApiConfig = {
  clientId: string;
  clientSecret: string;
  endpoint: string;
};

export type SpApiConnectionConfig = SpApiConfig & {
  marketplaceId: string;
  sellerId: string;
  region: SpApiRegion;
  refreshToken: string;
};

export class SpApiConfigurationError extends Error {
  constructor(
    readonly code:
      "INVALID_PROVIDER_MODE" | "MISSING_CONFIGURATION" | "INVALID_ENDPOINT",
  ) {
    super(code);
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value || value.startsWith("replace-with-"))
    throw new SpApiConfigurationError("MISSING_CONFIGURATION");
  return value;
}

export function providerMode(
  environment: Environment = process.env,
): ProviderMode {
  const configured = environment.PROVIDER_MODE?.trim() || "mock";
  if (configured === "mock") return "mock";
  // `sp-api` was the pre-7.6 spelling. Keep it temporarily to avoid a silent
  // live-provider outage while normalizing new configuration to `sp_api`.
  if (configured === "sp_api" || configured === "sp-api") return "sp_api";
  throw new SpApiConfigurationError("INVALID_PROVIDER_MODE");
}

function endpointRegion(endpoint: string): SpApiRegion | undefined {
  return (Object.keys(SP_API_ENDPOINTS) as SpApiRegion[]).find(
    (region) => SP_API_ENDPOINTS[region] === endpoint,
  );
}

export function readSpApiConfig(
  environment: Environment = process.env,
): SpApiConfig {
  const endpoint = required(environment, "SP_API_ENDPOINT").replace(/\/$/, "");
  if (!endpointRegion(endpoint))
    throw new SpApiConfigurationError("INVALID_ENDPOINT");
  return {
    clientId: required(environment, "SP_API_LWA_CLIENT_ID"),
    clientSecret: required(environment, "SP_API_LWA_CLIENT_SECRET"),
    endpoint,
  };
}

/** Used only by the opt-in, server-side connection check. Runtime refresh tokens stay encrypted in PostgreSQL. */
export function readSpApiConnectionConfig(
  environment: Environment = process.env,
): SpApiConnectionConfig {
  const config = readSpApiConfig(environment);
  const region = endpointRegion(config.endpoint);
  if (!region) throw new SpApiConfigurationError("INVALID_ENDPOINT");
  return {
    ...config,
    region,
    marketplaceId: required(environment, "SP_API_MARKETPLACE_ID"),
    sellerId: required(environment, "SP_API_SELLER_ID"),
    refreshToken: required(environment, "SP_API_REFRESH_TOKEN"),
  };
}

export const SP_API_SENSITIVE_FIELD_NAMES = new Set([
  "authorization",
  "access_token",
  "refresh_token",
  "client_secret",
  "password",
  "signature",
  "credential",
  "x-amz-access-token",
  "x-amz-security-token",
  "x-amz-date",
]);

function isSensitiveName(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return (
    SP_API_SENSITIVE_FIELD_NAMES.has(normalized) ||
    normalized.includes("access_token") ||
    normalized.includes("refresh_token") ||
    normalized.includes("client_secret") ||
    normalized.includes("authorization") ||
    normalized.includes("signature")
  );
}

function isTokenLike(value: string): boolean {
  return /(?:Atzr|Atza)\|/i.test(value) || /^Bearer\s+/i.test(value);
}

export function redactSpApiHeaders(
  headers: HeadersInit = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    result[name] =
      isSensitiveName(name) || isTokenLike(value) ? "[REDACTED]" : value;
  });
  return result;
}

export function redactSpApiUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveName(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

export function redactSpApiPayload(value: unknown): unknown {
  if (typeof value === "string")
    return isTokenLike(value) ? "[REDACTED]" : value;
  if (Array.isArray(value)) return value.map(redactSpApiPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        isSensitiveName(key) ? "[REDACTED]" : redactSpApiPayload(child),
      ]),
    );
  }
  return value;
}

export function retryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function responseError(response: Response): ProviderError {
  const requestId =
    response.headers.get("x-amzn-requestid") ??
    response.headers.get("x-amzn-request-id") ??
    undefined;
  const retryAfterMs = retryAfterMilliseconds(
    response.headers.get("retry-after"),
  );
  const code =
    response.status === 401
      ? "UNAUTHORIZED"
      : response.status === 403
        ? "FORBIDDEN"
        : response.status === 404
          ? "NOT_FOUND"
          : response.status === 429
            ? "THROTTLED"
            : response.status === 400 || response.status === 422
              ? "INVALID_REQUEST"
              : response.status >= 500
                ? "PROVIDER_OUTAGE"
                : "TRANSIENT";
  return new ProviderError(code, {
    httpStatus: response.status,
    ...(requestId ? { providerRequestId: requestId } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const authorizationTokenSchema = tokenSchema.extend({
  refresh_token: z.string().min(1),
  token_type: z.string().min(1).optional(),
});

export async function exchangeAuthorizationCode(
  config: SpApiConfig,
  authorizationCode: string,
  redirectUri: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}> {
  let response: Response;
  try {
    response = await fetchImplementation(
      "https://api.amazon.com/auth/o2/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authorizationCode,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      },
    );
  } catch {
    throw new ProviderError("TRANSIENT");
  }
  if (!response.ok) throw responseError(response);
  try {
    const token = authorizationTokenSchema.parse(await response.json());
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresInSeconds: token.expires_in,
    };
  } catch {
    throw new ProviderError("INVALID_RESPONSE", {
      httpStatus: response.status,
    });
  }
}

export async function exchangeRefreshToken(
  config: SpApiConfig,
  refreshToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  let response: Response;
  try {
    response = await fetchImplementation(
      "https://api.amazon.com/auth/o2/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      },
    );
  } catch {
    throw new ProviderError("TRANSIENT");
  }
  if (!response.ok) throw responseError(response);
  try {
    const token = tokenSchema.parse(await response.json());
    return {
      accessToken: token.access_token,
      expiresInSeconds: token.expires_in,
    };
  } catch {
    throw new ProviderError("INVALID_RESPONSE", {
      httpStatus: response.status,
    });
  }
}

export class LwaAccessTokenProvider {
  private cached: { value: string; usableUntil: number } | undefined;
  private refreshInFlight: Promise<string> | undefined;

  constructor(
    private readonly config: SpApiConfig,
    private readonly refreshToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.usableUntil > this.now())
      return this.cached.value;
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async refresh(): Promise<string> {
    const exchanged = await exchangeRefreshToken(
      this.config,
      this.refreshToken,
      this.fetchImplementation,
    );
    const safetyWindowSeconds = Math.min(
      60,
      Math.max(1, Math.floor(exchanged.expiresInSeconds / 10)),
    );
    this.cached = {
      value: exchanged.accessToken,
      usableUntil:
        this.now() +
        Math.max(0, exchanged.expiresInSeconds - safetyWindowSeconds) * 1_000,
    };
    return exchanged.accessToken;
  }
}

export type AccessTokenSupplier = (() => Promise<string>) & {
  invalidate?: () => void;
};

export type SpApiResponse = {
  body: unknown;
  observedAt: string;
  requestId?: string;
  rateLimitPerSecond?: number;
};

export class SpApiTransport {
  constructor(
    private readonly config: SpApiConfig,
    private readonly accessToken: AccessTokenSupplier,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async request(path: string, init: RequestInit = {}): Promise<SpApiResponse> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new ProviderError("INVALID_REQUEST");
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.config.endpoint}${path}`,
        {
          ...init,
          headers: {
            accept: "application/json",
            "x-amz-access-token": await this.accessToken(),
            ...init.headers,
          },
        },
      );
    } catch {
      throw new ProviderError("TRANSIENT");
    }
    if (!response.ok) {
      if (response.status === 401) this.accessToken.invalidate?.();
      throw responseError(response);
    }
    const requestId =
      response.headers.get("x-amzn-requestid") ??
      response.headers.get("x-amzn-request-id") ??
      undefined;
    const rawRateLimit = response.headers.get("x-amzn-ratelimit-limit");
    const parsedRateLimit =
      rawRateLimit === null ? Number.NaN : Number(rawRateLimit);
    try {
      return {
        body: await response.json(),
        observedAt: this.now().toISOString(),
        ...(requestId ? { requestId } : {}),
        ...(Number.isFinite(parsedRateLimit)
          ? { rateLimitPerSecond: parsedRateLimit }
          : {}),
      };
    } catch {
      throw new ProviderError("INVALID_RESPONSE", {
        httpStatus: response.status,
        ...(requestId ? { providerRequestId: requestId } : {}),
      });
    }
  }
}

export type SpApiConnectionStatus =
  | "MOCK"
  | "CONNECTED"
  | "MISCONFIGURED"
  | "UNAUTHORIZED"
  | "THROTTLED"
  | "UNAVAILABLE";

export type SpApiConnectionHealth = {
  provider: "amazon-sp-api";
  mode: ProviderMode;
  status: SpApiConnectionStatus;
  checkedAt: string;
  lastErrorCode?: string;
  rateLimitPerSecond?: number;
};

export function publicSpApiConfigurationStatus(
  environment: Environment = process.env,
  checkedAt = new Date().toISOString(),
): SpApiConnectionHealth {
  try {
    const mode = providerMode(environment);
    if (mode === "mock")
      return { provider: "amazon-sp-api", mode, status: "MOCK", checkedAt };
    const endpoint = required(environment, "SP_API_ENDPOINT").replace(
      /\/$/,
      "",
    );
    if (!endpointRegion(endpoint))
      throw new SpApiConfigurationError("INVALID_ENDPOINT");
    return {
      provider: "amazon-sp-api",
      mode,
      status: "UNAVAILABLE",
      checkedAt,
    };
  } catch (error) {
    return {
      provider: "amazon-sp-api",
      mode: "sp_api",
      status: "MISCONFIGURED",
      checkedAt,
      lastErrorCode:
        error instanceof SpApiConfigurationError
          ? error.code
          : "MISSING_CONFIGURATION",
    };
  }
}

/**
 * Smallest non-destructive authenticated SP-API probe. The Sellers endpoint
 * lists marketplace participations and requires no catalog, pricing, or write
 * operation. It is invoked only by the opt-in server-side smoke test today.
 */
export async function testSpApiConnection(
  transport: SpApiTransport,
): Promise<SpApiConnectionHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const result = await transport.request(
      "/sellers/v1/marketplaceParticipations",
    );
    return {
      provider: "amazon-sp-api",
      mode: "sp_api",
      status: "CONNECTED",
      checkedAt,
      ...(result.rateLimitPerSecond === undefined
        ? {}
        : { rateLimitPerSecond: result.rateLimitPerSecond }),
    };
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : "TRANSIENT";
    return {
      provider: "amazon-sp-api",
      mode: "sp_api",
      status:
        code === "UNAUTHORIZED" || code === "FORBIDDEN"
          ? "UNAUTHORIZED"
          : code === "THROTTLED"
            ? "THROTTLED"
            : "UNAVAILABLE",
      checkedAt,
      lastErrorCode: code,
    };
  }
}

const marketplaceParticipationSchema = z.object({
  marketplace: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    countryCode: z.string().min(1).optional(),
    defaultCurrencyCode: z.string().min(1).optional(),
    defaultLanguageCode: z.string().min(1).optional(),
    domainName: z.string().min(1).optional(),
  }),
  participation: z.object({
    isParticipating: z.boolean(),
    hasSuspendedListings: z.boolean(),
  }),
});

const marketplaceParticipationsSchema = z.object({
  payload: z.array(marketplaceParticipationSchema),
});

export type MarketplaceParticipation = {
  marketplaceId: string;
  name: string;
  countryCode?: string;
  defaultCurrencyCode?: string;
  defaultLanguageCode?: string;
  domainName?: string;
  isParticipating: boolean;
  hasSuspendedListings: boolean;
};

/** Normalizes only the documented Sellers v1 response. Raw payloads never
 * leave the worker/provider boundary. */
export async function getMarketplaceParticipations(
  transport: SpApiTransport,
): Promise<{
  participations: MarketplaceParticipation[];
  observedAt: string;
  requestId?: string;
  rateLimitPerSecond?: number;
}> {
  const result = await transport.request(
    "/sellers/v1/marketplaceParticipations",
  );
  let body: z.infer<typeof marketplaceParticipationsSchema>;
  try {
    body = marketplaceParticipationsSchema.parse(result.body);
  } catch {
    throw new ProviderError("INVALID_RESPONSE");
  }
  return {
    participations: body.payload.map(({ marketplace, participation }) => ({
      marketplaceId: marketplace.id,
      name: marketplace.name,
      ...(marketplace.countryCode
        ? { countryCode: marketplace.countryCode }
        : {}),
      ...(marketplace.defaultCurrencyCode
        ? { defaultCurrencyCode: marketplace.defaultCurrencyCode }
        : {}),
      ...(marketplace.defaultLanguageCode
        ? { defaultLanguageCode: marketplace.defaultLanguageCode }
        : {}),
      ...(marketplace.domainName ? { domainName: marketplace.domainName } : {}),
      isParticipating: participation.isParticipating,
      hasSuspendedListings: participation.hasSuspendedListings,
    })),
    observedAt: result.observedAt,
    ...(result.requestId ? { requestId: result.requestId } : {}),
    ...(result.rateLimitPerSecond === undefined
      ? {}
      : { rateLimitPerSecond: result.rateLimitPerSecond }),
  };
}
