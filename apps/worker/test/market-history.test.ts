import { describe, expect, it, vi } from "vitest";

vi.mock("@rizpoint/database", () => ({
  claimHistoryRefreshRun: vi.fn(),
  claimProviderRequestLease: vi.fn(),
  completeHistoryRefreshItem: vi.fn(),
  completeHistoryRefreshRun: vi.fn(),
  completeProviderRequestLease: vi.fn(),
  createResearchRepository: vi.fn(),
  findActiveProviderRateBudget: vi.fn(),
  getProviderCacheEntry: vi.fn(),
  putProviderCacheEntry: vi.fn(),
  recordProviderRequestTelemetry: vi.fn(),
  reserveProviderBudget: vi.fn(),
  settleProviderBudgetReservation: vi.fn(),
  upsertProviderEntitlement: vi.fn(),
}));
vi.mock("@rizpoint/object-storage", () => ({ putPrivateObject: vi.fn() }));
vi.mock("../src/market-history-provider.js", () => ({
  createMarketHistoryProvider: vi.fn(),
}));

import { keepaHistoryTokenEstimate } from "../src/market-history.js";

describe("Keepa token-budget guard", () => {
  it("requires an explicit decimal estimate and multiplies it exactly", () => {
    expect(keepaHistoryTokenEstimate(3, "1.25")).toBe("3.7500");
    expect(keepaHistoryTokenEstimate(3, "")).toBeNull();
    expect(keepaHistoryTokenEstimate(3, "0")).toBeNull();
    expect(keepaHistoryTokenEstimate(3, "1e3")).toBeNull();
    expect(keepaHistoryTokenEstimate(0, "1.25")).toBeNull();
  });
});
