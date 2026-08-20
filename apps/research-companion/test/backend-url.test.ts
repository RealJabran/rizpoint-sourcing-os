import { describe, expect, it } from "vitest";
import { normalizeBackendUrl } from "../src/backend-url.js";

describe("Research Companion backend origin", () => {
  it("allows HTTPS and loopback HTTP origins only", () => {
    expect(normalizeBackendUrl("https://research.example/path")).toBe(
      "https://research.example",
    );
    expect(normalizeBackendUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeBackendUrl("http://research.example")).toBeNull();
    expect(normalizeBackendUrl("file:///etc/passwd")).toBeNull();
    expect(
      normalizeBackendUrl("https://user:password@example.test"),
    ).toBeNull();
  });
});
