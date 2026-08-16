import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("analysis workspace accessibility contract", () => {
  it("keeps keyboard and assistive-technology affordances in the grid source", async () => {
    const workspaceSource = await readFile(
      new URL("../src/analysis/workspace.tsx", import.meta.url),
      "utf8",
    );
    const drawerSource = await readFile(
      new URL("../src/analysis/evidence-drawer.tsx", import.meta.url),
      "utf8",
    );
    expect(workspaceSource).toContain('role="grid"');
    expect(workspaceSource).toContain("aria-rowcount");
    expect(workspaceSource).toContain("Skip to results");
    expect(workspaceSource).toContain("Accessible table mode");
    expect(workspaceSource).toContain('<Alert tone="danger"');
    expect(workspaceSource).toContain('role="gridcell"');
    expect(workspaceSource).toContain("Previous page");
    expect(workspaceSource).not.toContain('className="sr-only"');
    expect(drawerSource).toContain('role="dialog"');
    expect(drawerSource).toContain("Candidate comparison and match features");
    expect(drawerSource).toContain("Audit history");
    expect(drawerSource).toContain('event.key === "Escape"');
  });
});
