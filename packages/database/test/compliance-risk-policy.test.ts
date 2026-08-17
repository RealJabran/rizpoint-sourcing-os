import { describe, expect, it } from "vitest";
import { screenComplianceRisk } from "../src/compliance-risk-policy.js";

const ruleSet = {
  ruleSetId: "ruleset_1",
  ruleSetName: "US screening",
  ruleSetVersion: "2026.08",
  sourceTitle: "Curated source register",
  sourceUrl: "https://example.test/rules",
  sourcePublishedAt: new Date("2026-08-01T00:00:00.000Z"),
  sourceAccessedAt: new Date("2026-08-17T00:00:00.000Z"),
};

describe("compliance-risk screening policy", () => {
  it("keeps unmatched domains unknown and blocks launch until verified", () => {
    const results = screenComplianceRisk({
      text: "stainless steel bottle",
      rules: [],
      ruleSet,
    });
    const ingestible = results.find(
      (item) => item.domain === "INGESTIBLE_FOOD_SUPPLEMENT",
    );
    expect(ingestible).toMatchObject({
      riskLevel: "UNKNOWN",
      doNotLaunchUntilVerified: true,
    });
  });

  it("retains rule source/version and explains a matched review domain", () => {
    const results = screenComplianceRisk({
      text: "wireless rechargeable baby monitor",
      ruleSet,
      rules: [
        {
          id: "radio-1",
          domain: "RADIO_WIRELESS",
          riskLevel: "REVIEW",
          matchTerms: ["wireless", "bluetooth"],
          rationale: "Wireless functionality needs authoritative review.",
          supplierQuestions: ["Which radio approvals apply?"],
          likelyDocumentation: ["Applicable radio documentation"],
          authoritativeClearance: false,
          sourceTitle: "Official source",
          sourceUrl: "https://example.test/radio",
          sourcePublishedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });
    const radio = results.find((item) => item.domain === "RADIO_WIRELESS");
    expect(radio).toMatchObject({
      riskLevel: "REVIEW",
      doNotLaunchUntilVerified: true,
    });
    expect(radio?.evidence[0]).toMatchObject({
      sourceTitle: "Official source",
      sourcePublishedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("does not turn an unauthoritative LOW rule into a clearance", () => {
    const results = screenComplianceRisk({
      text: "fabric tote",
      ruleSet,
      rules: [
        {
          id: "textile-low",
          domain: "TEXTILE_APPAREL_LABELING",
          riskLevel: "LOW",
          matchTerms: ["fabric"],
          rationale: "Low-risk internal screen.",
          supplierQuestions: [],
          likelyDocumentation: [],
          authoritativeClearance: false,
          sourceTitle: "Internal note",
          sourceUrl: "https://example.test/internal",
          sourcePublishedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });
    const textile = results.find(
      (item) => item.domain === "TEXTILE_APPAREL_LABELING",
    );
    expect(textile?.riskLevel).toBe("UNKNOWN");
    expect(textile?.why).not.toMatch(/no certification required/i);
  });

  it("labels seller eligibility as distinct from compliance clearance", () => {
    const results = screenComplianceRisk({
      text: "product",
      rules: [],
      ruleSet,
      amazonRestriction: {
        state: "ELIGIBLE",
        provider: "sp-api",
        observedAt: new Date("2026-08-17T00:00:00.000Z"),
        reference: "provider_observation_1",
      },
    });
    const amazon = results.find(
      (item) => item.domain === "AMAZON_RESTRICTED_CATEGORY",
    );
    expect(amazon).toMatchObject({ riskLevel: "UNKNOWN" });
    expect(amazon?.why).toMatch(/not a certification/i);
  });
});
