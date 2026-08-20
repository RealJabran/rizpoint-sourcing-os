import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("provider runtime schema", () => {
  it("defines capability truth, encrypted credentials, budgets, cache, leases, and sanitized attempts", async () => {
    const schema = await readFile(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    for (const model of [
      "ProviderCredential",
      "ProviderEntitlement",
      "ProviderRateBudget",
      "ProviderBudgetReservation",
      "ProviderCacheEntry",
      "ProviderRequestLease",
      "ProviderRequestAttempt",
      "ApiRateLimitBucket",
    ])
      expect(schema).toContain(`model ${model}`);
    for (const capability of [
      "CATALOG",
      "COMPETITIVE_OFFERS",
      "FEES",
      "RESTRICTIONS",
      "MARKET_HISTORY",
      "KEYWORD_DISCOVERY",
      "REVERSE_ASIN",
      "SEARCH_RANK",
      "CATEGORY_INTELLIGENCE",
      "BRAND_INTELLIGENCE",
      "SELLER_INTELLIGENCE",
      "AD_INTELLIGENCE",
      "REVIEW_INTELLIGENCE",
    ])
      expect(schema).toContain(capability);
    expect(schema).toMatch(/capacity\s+Decimal\s+@db\.Decimal\(20, 4\)/);
    expect(schema).toMatch(/estimatedCost\s+Decimal\?/);
    expect(schema).not.toContain("plaintextSecret");
    expect(schema).not.toContain("requestPayload");
    expect(schema).toContain("dataUsageScope");
    expect(schema).toContain("exportableFields");
    expect(schema).toContain("dataRetentionDays");
    for (const deployedName of [
      "provider_entitlements_org_provider_market_capability_key",
      "provider_budget_reservations_org_budget_request_key",
      "provider_cache_entries_request_key",
      "provider_request_leases_request_key",
      "provider_request_attempts_request_attempt_key",
    ])
      expect(schema).toContain(`map: "${deployedName}"`);
  });

  it("ships an additive reversible migration with numeric and tenant constraints", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260816140000_provider_runtime_truth_layer/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rollback = await readFile(
      new URL(
        "../prisma/migrations/20260816140000_provider_runtime_truth_layer/rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain('CREATE TYPE "ProviderCapability"');
    expect(migration).toContain(
      'CONSTRAINT "provider_rate_budgets_amounts_check"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("entitlement_id", "organization_id")',
    );
    expect(migration).not.toMatch(
      /ALTER TABLE "(?:supplier_rows|profit_results)"/,
    );
    expect(migration).not.toContain("DROP COLUMN");
    expect(rollback).toContain('DROP TABLE IF EXISTS "provider_entitlements"');
    expect(rollback).toContain('DROP TYPE IF EXISTS "ProviderCapability"');
  });

  it("ships reversible provider-rights and durable rate-limit controls", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260819100000_security_data_rights/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rollback = await readFile(
      new URL(
        "../prisma/migrations/20260819100000_security_data_rights/rollback.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("provider_entitlements_export_rights_check");
    expect(migration).toContain("api_rate_limit_buckets_identity_key");
    expect(migration).toContain(
      'FOREIGN KEY ("organization_id") REFERENCES "organizations"',
    );
    expect(rollback).toContain('DROP TABLE IF EXISTS "api_rate_limit_buckets"');
    expect(rollback).toContain('DROP TYPE IF EXISTS "ProviderExportPolicy"');
  });
});
