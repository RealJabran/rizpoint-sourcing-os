import { describe, expect, it } from "vitest";
import { hypothesisFor } from "../src/repositories/differentiation.js";

describe("differentiation brief hypotheses", () => {
  it("keeps supplier validation tied to visible evidence and confidence", () => {
    const hypothesis = hypothesisFor({
      themeId: "theme-1",
      kind: "PACKAGING",
      label: "Packaging",
      reviewCount: 5,
      averageRating: "1.20",
      evidenceReviewIds: ["review-1", "review-2"],
    });
    expect(hypothesis.confidence).toBe("MEDIUM");
    expect(hypothesis.evidenceReviewIds).toEqual(["review-1", "review-2"]);
    expect(hypothesis.validationQuestion).toContain("packaging");
  });
});
