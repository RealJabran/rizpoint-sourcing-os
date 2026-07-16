import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("analysis workspace accessibility contract", () => {
  it("keeps keyboard and assistive-technology affordances in the grid source", async () => {
    const source = await readFile(
      new URL("../src/analysis/workspace.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('role="grid"');
    expect(source).toContain("aria-rowcount");
    expect(source).toContain("Skip to results");
    expect(source).toContain("Accessible table mode");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('<Alert tone="danger"');
    expect(source).toContain('role="gridcell"');
    expect(source).toContain("Candidate comparison and match features");
    expect(source).toContain("Audit history");
    expect(source).toContain("Previous page");
    expect(source).toContain('event.key === "Escape"');
    expect(source).not.toContain('className="sr-only"');
  });
});
