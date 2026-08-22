import { describe, expect, it } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
import { providerConnectionRetryDelay } from "../src/job-policy.js";

describe("provider connection retry policy", () => {
  it("honors Amazon Retry-After within safe bounds", () => {
    expect(
      providerConnectionRetryDelay(
        new ProviderError("THROTTLED", { retryAfterMs: 90_000 }),
      ),
    ).toBe(90_000);
    expect(
      providerConnectionRetryDelay(
        new ProviderError("THROTTLED", { retryAfterMs: 50 }),
      ),
    ).toBe(1_000);
  });

  it("uses a conservative delay without provider guidance", () => {
    expect(providerConnectionRetryDelay(new Error("outage"))).toBe(30_000);
  });
});
