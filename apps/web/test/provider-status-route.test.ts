import { afterEach, describe, expect, it, vi } from "vitest";

const phaseZeroDemoEnabled = vi.fn();
const publicSpApiConfigurationStatus = vi.fn();
const providerMode = vi.fn();
const ensurePhaseZeroOrganization = vi.fn();
const getAmazonProviderConnectionStatus = vi.fn();

vi.mock("@/src/phase-zero", () => ({ phaseZeroDemoEnabled }));
vi.mock("@rizpoint/amazon-sp-api", () => ({
  publicSpApiConfigurationStatus,
  providerMode,
}));
vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  getAmazonProviderConnectionStatus,
}));

describe("provider status route", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns a sanitized mock status without a credential-shaped field", async () => {
    phaseZeroDemoEnabled.mockReturnValue(true);
    publicSpApiConfigurationStatus.mockReturnValue({
      provider: "amazon-sp-api",
      mode: "mock",
      status: "MOCK",
      checkedAt: "2026-07-16T00:00:00.000Z",
    });
    providerMode.mockReturnValue("mock");
    const { GET } = await import("../app/api/providers/amazon/route.js");
    const body = await (await GET()).json();
    expect(body).toEqual({
      provider: "amazon-sp-api",
      mode: "mock",
      status: "MOCK",
      checkedAt: "2026-07-16T00:00:00.000Z",
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
    providerMode.mockReturnValue("sp_api");
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org" });
    getAmazonProviderConnectionStatus.mockResolvedValue({
      status: "ERROR",
      lastValidatedAt: new Date("2026-07-16T00:00:00.000Z"),
      lastSuccessAt: null,
      lastErrorCode: "PROVIDER_OUTAGE",
    });
    const { GET } = await import("../app/api/providers/health/route.js");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      provider: "amazon-sp-api",
      mode: "sp_api",
      status: "UNAVAILABLE",
      checkedAt: "2026-07-16T00:00:00.000Z",
      lastErrorCode: "PROVIDER_OUTAGE",
    });
  });
});
