import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const phaseZeroDemoEnabled = vi.fn();
const isLocalDemoMode = vi.fn();
const publicSpApiConfigurationStatus = vi.fn();
const ensurePhaseZeroOrganization = vi.fn();
const ensureMockAmazonConnection = vi.fn();
const getAmazonProviderConnectionStatus = vi.fn();
const listProviderCapabilityStates = vi.fn();
const hasActiveProviderCredential = vi.fn();
const getAmazonIntegrationStatus = vi.fn();
const getLatestAmazonConnectionJob = vi.fn();
const amazonOAuthPublicConfigurationAvailable = vi.fn();
const requirePrivateAccess = vi.fn();
const organizationForRequest = vi.fn();

vi.mock("@/src/phase-zero", () => ({
  phaseZeroDemoEnabled,
  isLocalDemoMode,
}));
vi.mock("@/src/private-access", () => ({ requirePrivateAccess }));
vi.mock("@/src/request-organization", () => ({ organizationForRequest }));
vi.mock("@rizpoint/amazon-sp-api", () => ({
  publicSpApiConfigurationStatus,
  amazonOAuthPublicConfigurationAvailable,
}));
vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  ensureMockAmazonConnection,
  getAmazonProviderConnectionStatus,
  listProviderCapabilityStates,
  hasActiveProviderCredential,
  getAmazonIntegrationStatus,
  getLatestAmazonConnectionJob,
}));

describe("provider status route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps local fixtures distinct from a live Amazon connection", async () => {
    requirePrivateAccess.mockReturnValue(null);
    organizationForRequest.mockResolvedValue({ id: "org" });
    isLocalDemoMode.mockReturnValue(true);
    amazonOAuthPublicConfigurationAvailable.mockReturnValue(false);
    getAmazonIntegrationStatus.mockResolvedValue(null);
    getLatestAmazonConnectionJob.mockResolvedValue(null);
    const { GET } = await import("../app/api/providers/amazon/route.js");
    const body = await (
      await GET(new NextRequest("http://localhost/api/providers/amazon"))
    ).json();
    expect(body).toMatchObject({
      provider: "amazon-sp-api",
      connectionState: "NOT_CONNECTED",
      dataOrigin: "NONE",
      localDemo: true,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /refreshToken|accessToken|clientSecret|ciphertext|encryptedRefreshToken/i,
    );
  });

  it("keeps provider health availability explicit without returning provider details", async () => {
    requirePrivateAccess.mockReturnValue(null);
    organizationForRequest.mockResolvedValue({ id: "org" });
    isLocalDemoMode.mockReturnValue(false);
    amazonOAuthPublicConfigurationAvailable.mockReturnValue(false);
    getLatestAmazonConnectionJob.mockResolvedValue(null);
    getAmazonIntegrationStatus.mockResolvedValue({
      id: "connection",
      mode: "SELF_AUTHORIZED",
      status: "ERROR",
      sellerId: "seller",
      marketplaceId: "ATVPDKIKX0DER",
      region: "NA",
      authorizedAt: null,
      lastValidatedAt: new Date("2026-07-16T00:00:00.000Z"),
      lastSuccessAt: null,
      lastErrorCode: "PROVIDER_OUTAGE",
      revokedAt: null,
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      marketplaces: [],
      entitlements: [],
      jobs: [],
    });
    const { GET } = await import("../app/api/providers/health/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/providers/health"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      provider: "amazon-sp-api",
      connectionState: "ERROR",
      dataOrigin: "NONE",
      connection: { lastErrorCode: "PROVIDER_OUTAGE" },
    });
  });

  it("returns only the safe live projection for an active tenant connection", async () => {
    requirePrivateAccess.mockReturnValue(null);
    organizationForRequest.mockResolvedValue({ id: "org" });
    isLocalDemoMode.mockReturnValue(false);
    amazonOAuthPublicConfigurationAvailable.mockReturnValue(true);
    getLatestAmazonConnectionJob.mockResolvedValue(null);
    getAmazonIntegrationStatus.mockResolvedValue({
      id: "connection-internal",
      mode: "OAUTH",
      status: "ACTIVE",
      sellerId: "A123456789XYZ",
      marketplaceId: "ATVPDKIKX0DER",
      region: "NA",
      authorizedAt: new Date("2026-08-22T00:00:00.000Z"),
      lastValidatedAt: new Date("2026-08-22T01:00:00.000Z"),
      lastSuccessAt: new Date("2026-08-22T01:00:00.000Z"),
      lastErrorCode: null,
      revokedAt: null,
      updatedAt: new Date("2026-08-22T01:00:00.000Z"),
      marketplaces: [
        {
          marketplaceId: "ATVPDKIKX0DER",
          name: "Amazon.com",
          countryCode: "US",
          domainName: "www.amazon.com",
          defaultCurrencyCode: "USD",
          defaultLanguageCode: "en_US",
          isParticipating: true,
          hasSuspendedListings: false,
          isDefault: true,
          observedAt: new Date("2026-08-22T01:00:00.000Z"),
        },
      ],
      entitlements: [
        {
          marketplaceId: "ATVPDKIKX0DER",
          capability: "CATALOG",
          state: "HEALTHY",
          reasonCode: null,
          checkedAt: new Date("2026-08-22T01:00:00.000Z"),
          lastSuccessAt: new Date("2026-08-22T01:00:00.000Z"),
        },
      ],
      jobs: [],
      encryptedRefreshToken: "must-not-leak",
    });
    const { GET } = await import("../app/api/providers/amazon/route.js");
    const response = await GET(
      new NextRequest("http://localhost/api/providers/amazon"),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      provider: "amazon-sp-api",
      connectionState: "CONNECTED",
      dataOrigin: "LIVE_PROVIDER",
      connection: {
        mode: "OAUTH",
        sellerIdentity: "Seller account ••••9XYZ",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /must-not-leak|refreshToken|accessToken|clientSecret|ciphertext|connection-internal/i,
    );
  });

  it("labels recorded history fixtures as mock data and never returns a Keepa key", async () => {
    vi.stubEnv("MARKET_HISTORY_PROVIDER_MODE", "mock");
    phaseZeroDemoEnabled.mockReturnValue(true);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org" });
    ensureMockAmazonConnection.mockResolvedValue({
      marketplaceId: "ATVPDKIKX0DER",
    });
    listProviderCapabilityStates.mockResolvedValue([
      {
        providerKey: "mock-amazon",
        marketplaceId: "ATVPDKIKX0DER",
        capability: "MARKET_HISTORY",
        mode: "MOCK",
        state: "HEALTHY",
        checkedAt: "2026-07-16T00:00:00.000Z",
        completeness: "COMPLETE",
      },
    ]);
    const { GET } =
      await import("../app/api/providers/market-history/route.js");
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      provider: "recorded-history",
      mode: "MOCK",
      dataOrigin: "RECORDED_FIXTURE",
    });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|ciphertext|secret/i);
  });

  it("surfaces persisted live quota state without disclosing configuration", async () => {
    vi.stubEnv("MARKET_HISTORY_PROVIDER_MODE", "keepa");
    phaseZeroDemoEnabled.mockReturnValue(true);
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org" });
    hasActiveProviderCredential.mockResolvedValue(true);
    listProviderCapabilityStates.mockResolvedValue([
      {
        providerKey: "keepa",
        marketplaceId: "ATVPDKIKX0DER",
        capability: "MARKET_HISTORY",
        mode: "LIVE",
        state: "QUOTA_EXHAUSTED",
        checkedAt: "2026-08-16T00:00:00.000Z",
        retryAt: "2026-08-16T01:00:00.000Z",
        reason: "QUOTA_WINDOW_EXHAUSTED",
        completeness: "UNKNOWN",
      },
    ]);
    const { GET } =
      await import("../app/api/providers/market-history/route.js");
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      provider: "keepa",
      mode: "LIVE",
      status: "QUOTA_EXHAUSTED",
      checkedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|ciphertext|secret/i);
  });
});
