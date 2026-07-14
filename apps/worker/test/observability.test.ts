import { describe, expect, it } from "vitest";
import { redactText } from "../src/observability.js";

describe("worker log redaction", () => {
  it("removes credential-shaped error details", () => {
    const value = redactText(
      "https://user:password@example.test failed: Bearer secret access_token=abc refresh_token=def",
    );
    expect(value).not.toContain("password");
    expect(value).not.toContain("secret");
    expect(value).not.toContain("abc");
    expect(value).not.toContain("def");
  });
});
