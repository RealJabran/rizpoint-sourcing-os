import { describe, expect, it } from "vitest";
import { analyzeListingCopy } from "../src/listing-analyzer.js";

describe("listing analyzer", () => {
  it("decomposes a score and separates a compliance risk from SEO", () => {
    const report = analyzeListingCopy({
      title:
        "A title that is deliberately long enough to meet the deterministic structure rule",
      bullets: ["easy use", "durable construction"],
      targetKeywords: ["durable", "missing phrase"],
      prohibitedTerms: ["guaranteed"],
      description: "Guaranteed to cure every problem.",
    });
    expect(
      report.components.find((item) => item.key === "keywords")?.score,
    ).toBe(50);
    expect(
      report.warnings.some((item) => item.kind === "COMPLIANCE_RISK"),
    ).toBe(true);
    expect(
      report.warnings.some((item) => item.kind === "SEO_OPPORTUNITY"),
    ).toBe(true);
  });
});
