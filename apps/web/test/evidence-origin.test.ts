import { describe, expect, it } from "vitest";
import { evidenceOrigin } from "../src/components/evidence-origin.js";

describe("evidence origin labels", () => {
  it("keeps persisted Amazon and mock evidence visually distinct", () => {
    expect(evidenceOrigin("amazon-sp-api")).toBe("STORED AMAZON");
    expect(evidenceOrigin("mock-amazon")).toBe("MOCK");
  });

  it("distinguishes licensed, user, and derived sources", () => {
    expect(evidenceOrigin("keepa-api")).toBe("LICENSED PROVIDER");
    expect(evidenceOrigin("user import")).toBe("USER INPUT");
    expect(evidenceOrigin("Deterministic assessment")).toBe("DERIVED");
  });
});
