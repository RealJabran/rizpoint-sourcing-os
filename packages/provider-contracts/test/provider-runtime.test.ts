import { describe, expect, it } from "vitest";
import {
  providerCapabilityStateSchema,
  providerRequestTelemetrySchema,
} from "../src/index.js";
import {
  DEFAULT_PROVIDER_FRESHNESS_POLICIES,
  providerFailureState,
  resolveProviderFreshnessPolicy,
} from "../src/runtime-policy.js";

describe("provider runtime contracts", () => {
  it("keeps fixture and live origin explicit in every capability", () => {
    expect(
      providerCapabilityStateSchema.parse({
        providerKey: "mock-amazon",
        marketplaceId: "ATVPDKIKX0DER",
        capability: "CATALOG",
        mode: "MOCK",
        state: "HEALTHY",
        checkedAt: "2026-08-16T08:00:00.000Z",
        completeness: "COMPLETE",
      }).mode,
    ).toBe("MOCK");
  });

  it("expresses quota and throttle failures without converting metrics to zero", () => {
    expect(providerFailureState("QUOTA_EXHAUSTED")).toEqual({
      state: "QUOTA_EXHAUSTED",
      reason: "QUOTA_WINDOW_EXHAUSTED",
    });
    expect(providerFailureState("THROTTLED")).toEqual({
      state: "THROTTLED",
      reason: "PROVIDER_THROTTLED",
    });
    expect(
      providerCapabilityStateSchema.parse({
        providerKey: "licensed-provider",
        marketplaceId: "ATVPDKIKX0DER",
        capability: "KEYWORD_DISCOVERY",
        mode: "LIVE",
        state: "QUOTA_EXHAUSTED",
        checkedAt: "2026-08-16T08:00:00.000Z",
        retryAt: "2026-08-17T08:00:00.000Z",
        reason: "QUOTA_WINDOW_EXHAUSTED",
        completeness: "UNKNOWN",
      }),
    ).not.toHaveProperty("value");
  });

  it("defines explicit freshness windows for every capability", () => {
    expect(Object.keys(DEFAULT_PROVIDER_FRESHNESS_POLICIES)).toHaveLength(13);
    for (const policy of Object.values(DEFAULT_PROVIDER_FRESHNESS_POLICIES)) {
      expect(policy.freshForSeconds).toBeGreaterThan(0);
      expect(policy.retainForSeconds).toBeGreaterThanOrEqual(
        policy.freshForSeconds,
      );
    }
  });

  it("allows bounded freshness overrides without permitting impossible retention", () => {
    expect(
      resolveProviderFreshnessPolicy("CATALOG", {
        freshForSeconds: 60,
        staleWhileRevalidateSeconds: 30,
        retainForSeconds: 90,
      }),
    ).toMatchObject({
      capability: "CATALOG",
      freshForSeconds: 60,
      staleWhileRevalidateSeconds: 30,
      retainForSeconds: 90,
    });
    expect(() =>
      resolveProviderFreshnessPolicy("CATALOG", {
        freshForSeconds: 60,
        staleWhileRevalidateSeconds: 31,
        retainForSeconds: 90,
      }),
    ).toThrow("PROVIDER_RETENTION_WINDOW_INVALID");
  });

  it("rejects payload-shaped telemetry while accepting sanitized hashes and Decimal costs", () => {
    const parsed = providerRequestTelemetrySchema.parse({
      providerKey: "licensed-provider",
      marketplaceId: "ATVPDKIKX0DER",
      capability: "MARKET_HISTORY",
      operation: "history",
      requestHash: "sha256:fixture",
      mode: "LIVE",
      state: "HEALTHY",
      attempt: 1,
      startedAt: "2026-08-16T08:00:00.000Z",
      completedAt: "2026-08-16T08:00:01.000Z",
      cost: { unit: "CREDIT", estimatedUnits: "2.5000" },
      payload: { token: "must-not-survive" },
    });
    expect(parsed).not.toHaveProperty("payload");
    expect(parsed.cost?.estimatedUnits).toBe("2.5000");
  });
});
