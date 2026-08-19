import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { explainProductComparison } from "../src/repositories/project-hub.js";

describe("project decision hub", () => {
  it("explains supported product differences deterministically without inventing a score", () => {
    const left = {
      id: "a",
      label: "A",
      asin: null,
      brand: null,
      opportunityScore: "80",
      unitsLow: "100",
      unitsHigh: "200",
      confidencePercent: "90",
      complianceRisk: "LOW",
      observedAt: null,
    };
    const right = {
      ...left,
      id: "b",
      label: "B",
      opportunityScore: "60",
      unitsLow: "150",
      confidencePercent: "70",
      complianceRisk: "HIGH",
    };
    expect(explainProductComparison(left, right)).toEqual([
      "A is stronger on opportunity score (80 vs 60).",
      "B is stronger on estimated monthly units (low range) (100 vs 150).",
      "A is stronger on estimate confidence (90 vs 70).",
      "A has the lower recorded compliance risk.",
    ]);
  });

  it("ships immutable decision snapshots with tenant-scoped source references", async () => {
    const schema = await readFile(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260817190000_project_decision_hub/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const model of [
      "ProjectEvidenceReference",
      "ProjectAssumption",
      "DecisionMemo",
      "DecisionMemoSource",
    ])
      expect(schema).toContain(`model ${model}`);
    expect(schema).toContain("sourceSnapshot Json");
    expect(schema).toContain(
      "@@unique([decisionMemoId, sourceType, sourceId])",
    );
    expect(migration).toContain('CREATE TYPE "DecisionMemoOutcome"');
    expect(migration).toContain(
      'REFERENCES "research_projects"("id", "organization_id")',
    );
  });
});
