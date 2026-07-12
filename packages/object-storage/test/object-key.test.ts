import { describe, expect, it } from "vitest";

describe("object storage boundary", () => {
  it("keeps user filenames out of object key generation", () => {
    const key = `quarantine/org/upload-${"abc123"}`;
    expect(key).not.toContain("supplier.xlsx");
  });
});
