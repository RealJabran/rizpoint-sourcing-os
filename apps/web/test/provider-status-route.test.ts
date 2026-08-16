import { afterEach, describe, expect, it, vi } from "vitest";

const phaseZeroDemoEnabled = vi.fn();
const publicSpApiConfigurationStatus = vi.fn();
const ensurePhaseZeroOrganization = vi.fn();
const ensureMockAmazonConnection = vi.fn();
const getAmazonProviderConnectionStatus = vi.fn();
const listProviderCapabilityStates = vi.fn();
const hasActiveProviderCredential = vi.fn();

vi.mock("@/src/phase-zero", () => ({ phaseZeroDemoEnabled }));
vi.mock("@rizpoint/amazon-sp-api", () => ({
  publicSpApiConfigurationStatus,
}));
vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  ensureMockAmazonConnection,
  getAmazonProviderConnectionStatus,
  listProviderCapabilityStates,
  hasActiveProviderCredential,
}));

describe("provider status route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns a sanitized mock status without a credential-shaped field", async () => {
    phaseZeroDemoEnabled.mockReturnValue(true);
    publicSpApiConfigurationStatus.mockReturnValue({
      provider: "amazon-sp-api",
      mode: "mock",
      status: "MOCK",
      checkedAt: "2026-07-16T00:00:00.000Z",
    });
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org" });
    ensureMockAmazonConnection.mockResolvedValue({
      marketplaceId: "ATVPDKIKX0DER",
    });
    listProviderCapabilityStates.mockResolvedValue([
      {
        providerKey: "mock-amazon",
        marketplaceId: "ATVPDKIKX0DER",
        capability: "CATALOG",
        mode: "MOCK",
        state: "HEALTHY",
        checkedAt: "2026-07-16T00:00:00.000Z",
        completeness: "COMPLETE",
      },
    ]);
    const { GET } = await import("../app/api/providers/amazon/route.js");
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      provider: "mock-amazon",
      mode: "MOCK",
      status: "HEALTHY",
      checkedAt: "2026-07-16T00:00:00.000Z",
      dataOrigin: "MOCK_FIXTURE",
    });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|credential/i);
  });

  it("keeps provider health availability explicit without returning provider details", async () => {
    phaseZeroDemoEnabled.mockReturnValue(true);
    publicSpApiConfigurationStatus.mockReturnValue({
      provider: "amazon-sp-api",
      mode: "sp_api",
      status: "UNAVAILABLE",
      checkedAt: "2026-07-16T00:00:00.000Z",
      lastErrorCode: "PROVIDER_OUTAGE",
    });
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org" });
    getAmazonProviderConnectionStatus.mockResolvedValue({
      status: "ERROR",
      marketplaceId: "ATVPDKIKX0DER",
      lastValidatedAt: new Date("2026-07-16T00:00:00.000Z"),
      lastSuccessAt: null,
      lastErrorCode: "PROVIDER_OUTAGE",
    });
    listProviderCapabilityStates.mockResolvedValue([
      {
        providerKey: "amazon-sp-api",
        marketplaceId: "ATVPDKIKX0DER",
        capability: "CATALOG",
        mode: "LIVE",
        state: "UNAVAILABLE",
        checkedAt: "2026-07-16T00:00:00.000Z",
        reason: "PROVIDER_OUTAGE",
        completeness: "UNKNOWN",
      },
    ]);
    const { GET } = await import("../app/api/providers/health/route.js");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      provider: "amazon-sp-api",
      mode: "LIVE",
      status: "UNAVAILABLE",
      checkedAt: "2026-07-16T00:00:00.000Z",
      lastErrorCode: "PROVIDER_OUTAGE",
    });
  });

  it("explains missing live configuration per capability without secret fields", async () => {
    phaseZeroDemoEnabled.mockReturnValue(true);
    publicSpApiConfigurationStatus.mockReturnValue({
      provider: "amazon-sp-api",
      mode: "sp_api",
      status: "MISCONFIGURED",
      checkedAt: "2026-07-16T00:00:00.000Z",
      lastErrorCode: "MISSING_CONFIGURATION",
    });
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org" });
    const { GET } = await import("../app/api/providers/amazon/route.js");
    const response = await GET();
    const body = await response.json();
    expect(body).toMatchObject({
      provider: "amazon-sp-api",
      mode: "LIVE",
      status: "NOT_CONFIGURED",
      reason: "CREDENTIALS_MISSING",
    });
    expect(body.capabilities).toHaveLength(4);
    expect(body.capabilities[0]).toMatchObject({
      state: "NOT_CONFIGURED",
      reason: "CREDENTIALS_MISSING",
      completeness: "UNKNOWN",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /refreshToken|accessToken|clientSecret|ciphertext/i,
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
