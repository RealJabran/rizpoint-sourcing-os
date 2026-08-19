import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  batchWindows,
  HISTORY_POINT_WRITE_BATCH_SIZE,
  INTERACTIVE_RESEARCH_QUERY_TIMEOUT_MS,
  RESEARCH_SCALE_PROFILES,
} from "../src/research-performance.js";
import {
  REVERSE_ASIN_KEYWORD_WINDOW,
  REVERSE_ASIN_OBSERVATION_WINDOW,
} from "../src/repositories/reverse-asin.js";
import {
  RELATIONSHIP_OBSERVATION_WINDOW,
  RELATIONSHIP_SEED_WINDOW,
} from "../src/repositories/product-relationships.js";

describe("large research dataset policy", () => {
  it("plans the full 100k/1m/5m profile in bounded constant-size windows", () => {
    const profile = RESEARCH_SCALE_PROFILES.full;
    const productWindows = [...batchWindows(profile.products, 100)];
    const observationWindows = [
      ...batchWindows(profile.observations, HISTORY_POINT_WRITE_BATCH_SIZE),
    ];
    const keywordWindows = [
      ...batchWindows(profile.productKeywordObservations, 5_000),
    ];
    expect(productWindows).toHaveLength(1_000);
    expect(observationWindows).toHaveLength(1_000);
    expect(keywordWindows).toHaveLength(1_000);
    expect(keywordWindows.at(-1)).toEqual({ offset: 4_995_000, limit: 5_000 });
  });

  it("keeps interactive query and batch budgets bounded", () => {
    expect(INTERACTIVE_RESEARCH_QUERY_TIMEOUT_MS).toBe(8_000);
    expect(REVERSE_ASIN_OBSERVATION_WINDOW).toBe(10_000);
    expect(REVERSE_ASIN_KEYWORD_WINDOW).toBe(1_000);
    expect(RELATIONSHIP_SEED_WINDOW).toBe(500);
    expect(RELATIONSHIP_OBSERVATION_WINDOW).toBe(10_000);
    expect(() => [...batchWindows(10, 0)]).toThrow("BATCH_SIZE_INVALID");
    expect(() => [...batchWindows(-1, 10)]).toThrow("BATCH_TOTAL_INVALID");
  });

  it("ships reversible indexes for the measured high-volume query paths", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260819090000_research_scale_indexes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rollback = await readFile(
      new URL(
        "../prisma/migrations/20260819090000_research_scale_indexes/rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const index of [
      "listing_candidates_org_product_idx",
      "history_refresh_runs_due_retry_idx",
      "product_keyword_observations_org_product_keyword_idx",
      "historical_metric_series_org_product_metric_idx",
      "provider_observations_item_metric_status_observed_idx",
    ]) {
      expect(migration).toContain(index);
      expect(rollback).toContain(index);
    }
    expect(migration).not.toContain("CREATE TABLE");
    expect(migration).not.toContain("DROP COLUMN");
  });
});
