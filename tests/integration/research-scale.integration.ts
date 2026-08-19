import assert from "node:assert/strict";
import {
  db,
  Prisma,
  RESEARCH_SCALE_PROFILES,
} from "../../packages/database/src/index.js";

const profileName =
  process.env.RIZPOINT_SCALE_PROFILE === "full" ? "full" : "scaled";
const profile = RESEARCH_SCALE_PROFILES[profileName];
const queryBudgetMs = 8_000;

const baseline = await db.$transaction(
  async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT set_config('statement_timeout', '120s', true)`,
    );
    await transaction.$executeRaw(Prisma.sql`
      CREATE TEMP TABLE rp_scale_products (
        id BIGINT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        title TEXT NOT NULL
      ) ON COMMIT DROP
    `);
    await transaction.$executeRaw(Prisma.sql`
      CREATE TEMP TABLE rp_scale_observations (
        id BIGINT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        product_id BIGINT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        value NUMERIC(20,4) NOT NULL
      ) ON COMMIT DROP
    `);
    await transaction.$executeRaw(Prisma.sql`
      CREATE TEMP TABLE rp_scale_product_keywords (
        id BIGINT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        product_id BIGINT NOT NULL,
        keyword_id BIGINT NOT NULL,
        organic_rank INTEGER
      ) ON COMMIT DROP
    `);

    const fixtureStartedAt = performance.now();
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO rp_scale_products (id, organization_id, title)
      SELECT value, 'scale-org', 'Product ' || value
      FROM generate_series(1, ${profile.products}) value
    `);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO rp_scale_observations
        (id, organization_id, product_id, observed_at, value)
      SELECT value,
             'scale-org',
             ((value - 1) % ${profile.products}) + 1,
             TIMESTAMPTZ '2026-08-19 00:00:00+00' -
               (((value - 1) / ${profile.products}) * INTERVAL '1 day'),
             ((value % 10000)::numeric / 100)
      FROM generate_series(1, ${profile.observations}) value
    `);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO rp_scale_product_keywords
        (id, organization_id, product_id, keyword_id, organic_rank)
      SELECT value,
             'scale-org',
             ((value - 1) % ${profile.products}) + 1,
             ((value - 1) % GREATEST(${profile.products * 5}, 1)) + 1,
             ((value - 1) % 100) + 1
      FROM generate_series(1, ${profile.productKeywordObservations}) value
    `);
    await transaction.$executeRaw(
      Prisma.sql`CREATE INDEX rp_scale_observation_latest_idx ON rp_scale_observations (organization_id, product_id, observed_at DESC)`,
    );
    await transaction.$executeRaw(
      Prisma.sql`CREATE INDEX rp_scale_product_keyword_idx ON rp_scale_product_keywords (organization_id, product_id, keyword_id)`,
    );
    await transaction.$executeRaw(Prisma.sql`ANALYZE rp_scale_products`);
    await transaction.$executeRaw(Prisma.sql`ANALYZE rp_scale_observations`);
    await transaction.$executeRaw(
      Prisma.sql`ANALYZE rp_scale_product_keywords`,
    );
    const fixtureMs = Math.round(performance.now() - fixtureStartedAt);

    await transaction.$queryRaw(
      Prisma.sql`SELECT set_config('statement_timeout', ${`${queryBudgetMs}ms`}, true)`,
    );
    const latestStartedAt = performance.now();
    const latest = await transaction.$queryRaw<
      Array<{ id: bigint; value: { toString(): string } | null }>
    >(Prisma.sql`
      SELECT product.id, latest.value
      FROM rp_scale_products product
      LEFT JOIN LATERAL (
        SELECT observation.value
        FROM rp_scale_observations observation
        WHERE observation.organization_id = 'scale-org'
          AND observation.product_id = product.id
        ORDER BY observation.observed_at DESC
        LIMIT 1
      ) latest ON true
      WHERE product.id > ${profile.products - 100}
      ORDER BY product.id
      LIMIT 100
    `);
    const latestProductWindowMs = Math.round(
      performance.now() - latestStartedAt,
    );

    const keywordStartedAt = performance.now();
    const keywords = await transaction.$queryRaw<
      Array<{ keywordId: bigint; productCount: bigint }>
    >(Prisma.sql`
      SELECT keyword_id AS "keywordId",
             count(DISTINCT product_id)::bigint AS "productCount"
      FROM rp_scale_product_keywords
      WHERE organization_id = 'scale-org'
        AND product_id > ${profile.products - 100}
      GROUP BY keyword_id
      ORDER BY "productCount" DESC, "keywordId" ASC
      LIMIT 100
    `);
    const keywordProductWindowMs = Math.round(
      performance.now() - keywordStartedAt,
    );

    assert.equal(latest.length, 100);
    assert.ok(keywords.length > 0 && keywords.length <= 100);
    assert.ok(latestProductWindowMs < queryBudgetMs);
    assert.ok(keywordProductWindowMs < queryBudgetMs);
    return {
      profile: profileName,
      ...profile,
      fixtureMs,
      latestProductWindowMs,
      keywordProductWindowMs,
      queryBudgetMs,
    };
  },
  { timeout: 180_000 },
);

console.log(JSON.stringify({ researchScaleBaseline: baseline }));
await db.$disconnect();
