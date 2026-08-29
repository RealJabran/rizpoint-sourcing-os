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

  it("permits eval only for local development tooling", () => {
    expect(
      contentSecurityPolicy("http://localhost:9000", "development"),
    ).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(
      contentSecurityPolicy("https://storage.example", "production"),
    ).not.toContain("unsafe-eval");
  });

  it("allows only documented Amazon catalog image origins in production", () => {
    const policy = contentSecurityPolicy(
      "https://storage.example",
      "production",
    );
    expect(policy).toContain(
      "img-src 'self' data: https://images-na.ssl-images-amazon.com https://m.media-amazon.com",
    );
    expect(policy).not.toContain("img-src *");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("rejects an insecure storage origin from the production browser policy", () => {
    const policy = contentSecurityPolicy(
      "http://storage.example",
      "production",
    );
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("http://storage.example");
  });

  it("preserves the explicit loopback-only Compose demo without weakening public production", () => {
    const policy = contentSecurityPolicy("http://localhost:9000", "production");
    expect(policy).toContain("connect-src 'self' http://localhost:9000");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
