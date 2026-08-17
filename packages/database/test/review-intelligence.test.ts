import { describe, expect, it } from "vitest";
import {
  classifyReviewTheme,
  redactReviewText,
  reviewDedupeHash,
} from "../src/review-intelligence.js";

describe("review intelligence safeguards", () => {
  it("redacts direct contact and order details before persistence", () => {
    expect(
      redactReviewText(
        "Email me@private.test, phone 555-222-1234, order #ABCD-12345",
      ),
    ).not.toContain("me@private.test");
  });
  it("creates stable dedupe keys and deterministic evidence labels", () => {
    expect(reviewDedupeHash("licensed:1", "great packaging")).toBe(
      reviewDedupeHash("licensed:1", "great packaging"),
    );
    expect(classifyReviewTheme("The box arrived damaged", 1)).toMatchObject({
      kind: "PACKAGING",
    });
  });
});
