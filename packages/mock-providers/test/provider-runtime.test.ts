import { describe, expect, it } from "vitest";
import {
  MockAmazonProvider,
  MockProviderCapabilityDiscovery,
} from "../src/index.js";

const marketplace = {
  marketplaceId: "ATVPDKIKX0DER",
  region: "NA" as const,
};

describe("mock provider runtime", () => {
  it("labels deterministic fixtures as MOCK even when healthy", async () => {
    const health = await new MockAmazonProvider().health(marketplace);
    expect(health.mode).toBe("MOCK");
    expect(health.status).toBe("HEALTHY");
    expect(health.capabilities.every((item) => item.mode === "MOCK")).toBe(
      true,
    );
  });

  it.each([
    ["THROTTLED", "PROVIDER_THROTTLED"],
    ["QUOTA_EXHAUSTED", "QUOTA_WINDOW_EXHAUSTED"],
    ["UNAVAILABLE", "PROVIDER_OUTAGE"],
    ["PARTIAL", "PARTIAL_RESPONSE"],
  ] as const)(
    "provides deterministic %s fault state",
    async (state, reason) => {
      const capabilities = await new MockProviderCapabilityDiscovery(
        state,
      ).capabilities(marketplace);
      expect(capabilities[0]).toMatchObject({ mode: "MOCK", state, reason });
    },
  );
});
