import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("normalization transaction budget", () => {
  it("prepares bulk projections before the bounded atomic transaction", async () => {
    const source = await readFile(
      new URL("../src/repositories.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export async function persistNormalizedRows");
    const end = source.indexOf("export async function queueMatching", start);
    const implementation = source.slice(start, end);
    expect(implementation.indexOf("const createdRows = rows.map")).toBeLessThan(
      implementation.indexOf("await db.$transaction"),
    );
    expect(implementation).toContain("{ maxWait: 10_000, timeout: 30_000 }");
    expect(implementation).toContain("await transaction.scanCheckpoint.upsert");
  });
});
