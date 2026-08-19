import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createResearchRepository,
  normalizeResearchPhrase,
} from "../src/repositories/research.js";
import {
  HistoricalSubjectType,
  ResearchObservationCompleteness,
  ResearchProjectMode,
} from "../src/index.js";

describe("research domain foundation", () => {
  it("normalizes keyword identity without changing the retained phrase", () => {
    expect(normalizeResearchPhrase("  Dog   Beds  ")).toBe("dog beds");
    expect(normalizeResearchPhrase("ＤＯＧ Beds")).toBe("dog beds");
  });

  it("exposes dual-mode projects and generic observation completeness", () => {
    expect(ResearchProjectMode.PRIVATE_LABEL).toBe("PRIVATE_LABEL");
    expect(ResearchProjectMode.WHOLESALE).toBe("WHOLESALE");
    expect(ResearchProjectMode.MANUAL_ASIN).toBe("MANUAL_ASIN");
    expect(ResearchObservationCompleteness.UNKNOWN).toBe("UNKNOWN");
    expect(HistoricalSubjectType.PRODUCT).toBe("PRODUCT");
  });

  it("keeps repository reads tenant-scoped and project creation explicit", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "project-1" });
    const repository = createResearchRepository({
      researchProject: { findFirst, create },
    } as never);

    await repository.getProject("org-a", "project-a");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "project-a", organizationId: "org-a" },
      }),
    );

    await repository.createProject({
      organizationId: "org-a",
      name: "Pet category research",
      mode: ResearchProjectMode.PRIVATE_LABEL,
      marketplaceId: "ATVPDKIKX0DER",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-a" }),
      }),
    );
  });

  it("rejects a project item whose typed subject reference is inconsistent", async () => {
    const repository = createResearchRepository({} as never);
    await expect(
      repository.addProjectItem({
        organizationId: "org-a",
        projectId: "project-a",
        kind: "PRODUCT",
        subjectKey: "product-a",
        keywordId: "keyword-a",
      }),
    ).rejects.toThrow("RESEARCH_ITEM_SUBJECT_INVALID");
  });

  it("persists history points in one bounded bulk write without hiding conflicts", async () => {
    const findSeries = vi.fn().mockResolvedValue({ id: "series-1" });
    const findObservation = vi.fn().mockResolvedValue({ id: "observation-1" });
    const findPoints = vi.fn().mockResolvedValue([]);
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const repository = createResearchRepository({
      historicalMetricSeries: { findFirst: findSeries },
      researchObservation: { findFirst: findObservation },
      historicalMetricPoint: { findMany: findPoints, createMany },
    } as never);
    const first = new Date("2026-08-01T00:00:00.000Z");
    const second = new Date("2026-08-02T00:00:00.000Z");
    await expect(
      repository.appendHistoricalMetricPoints({
        organizationId: "org-a",
        seriesId: "series-1",
        sourceObservationId: "observation-1",
        points: [
          { metricAt: first, value: { decimalValue: "19.990" } },
          { metricAt: first, value: { decimalValue: "19.99" } },
          { metricAt: second, value: { decimalValue: "20.00" } },
        ],
      }),
    ).resolves.toEqual({ insertedCount: 2, existingCount: 0 });
    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany.mock.calls[0]?.[0].data).toHaveLength(2);

    await expect(
      repository.appendHistoricalMetricPoints({
        organizationId: "org-a",
        seriesId: "series-1",
        sourceObservationId: "observation-1",
        points: [
          { metricAt: first, value: { decimalValue: "19.99" } },
          { metricAt: first, value: { decimalValue: "21.00" } },
        ],
      }),
    ).rejects.toThrow("HISTORICAL_POINT_IDEMPOTENCY_CONFLICT");
  });

  it("defines tenant, provenance, derived-lineage, and time-series policies in schema", async () => {
    const schema = await readFile(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    for (const model of [
      "ResearchProject",
      "ResearchProjectItem",
      "ResearchTag",
      "ResearchNote",
      "ProductWatch",
      "MarketDefinition",
      "MarketMember",
      "Keyword",
      "KeywordObservation",
      "ProductKeywordObservation",
      "ProductMarketObservation",
      "MarketObservation",
      "CategoryObservation",
      "BrandObservation",
      "SellerObservation",
      "HistoricalMetricSeries",
      "HistoricalMetricPoint",
      "OpportunityAssessment",
      "OpportunityReason",
      "AlertRule",
      "AlertEvent",
    ])
      expect(schema).toContain(`model ${model}`);

    expect(schema).toContain("model CatalogProduct");
    expect(schema).not.toContain("model ResearchProduct {");
    for (const field of [
      "providerKey",
      "operation",
      "marketplaceId",
      "observedAt",
      "freshnessState",
      "completeness",
      "rawEvidenceReference",
      "calculationVersion",
      "inputObservationReferences",
      "calculatedAt",
    ])
      expect(schema).toContain(field);
    expect(schema).toMatch(/score\s+Decimal\?/);
    expect(schema).toMatch(/decimalValue\s+Decimal\?/);
  });

  it("ships an additive reversible migration with retention indexes and checks", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260816062831_research_domain_foundation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rollback = await readFile(
      new URL(
        "../prisma/migrations/20260816062831_research_domain_foundation/rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain(
      'CREATE INDEX "historical_metric_points_metric_at_brin_idx"',
    );
    expect(migration).toContain(
      'CONSTRAINT "historical_metric_points_single_value_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "research_project_items_typed_subject_check"',
    );
    expect(migration).not.toMatch(
      /ALTER TABLE "(?:users|scan_jobs|supplier_rows)"/,
    );
    expect(migration).not.toContain("DROP COLUMN");
    expect(rollback).toContain('DROP TABLE IF EXISTS "research_projects"');
    expect(rollback).toContain('DROP TYPE IF EXISTS "ResearchProjectMode"');
  });
});
