import { describe, expect, it } from "vitest";
import { listingDraftCanBeApproved } from "../src/listing-builder-policy.js";

describe("fact-bound listing builder contracts", () => {
  it("blocks approval when any manually unverified claim remains", () => {
    expect(listingDraftCanBeApproved(["VERIFIED"])).toBe(true);
    expect(listingDraftCanBeApproved(["VERIFIED", "UNVERIFIED"])).toBe(false);
  });
});
