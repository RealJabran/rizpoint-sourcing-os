import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/content-security-policy.js";

describe("upload content security policy", () => {
  it("permits browser connections only to the configured public storage origin", () => {
    expect(
      contentSecurityPolicy("http://localhost:9000/private/path"),
    ).toContain("connect-src 'self' http://localhost:9000");
  });

  it("fails closed when the public storage endpoint is invalid", () => {
    expect(contentSecurityPolicy("not a url")).toContain("connect-src 'self'");
    expect(contentSecurityPolicy("not a url")).not.toContain(
      "connect-src 'self' http",
    );
  });
});
