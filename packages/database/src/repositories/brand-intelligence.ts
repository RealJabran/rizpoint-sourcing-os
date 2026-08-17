import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
export async function listBrandIntelligence(organizationId: string) {
  return db.$queryRaw<
    Array<{
      brand: string;
      productCount: bigint;
      medianPrice: { toString(): string } | null;
    }>
  >(Prisma.sql`
    WITH scoped AS (SELECT catalog_product_id AS id FROM listing_candidates WHERE organization_id=${organizationId} UNION SELECT catalog_product_id FROM research_project_items WHERE organization_id=${organizationId} AND catalog_product_id IS NOT NULL UNION SELECT catalog_product_id FROM product_watches WHERE organization_id=${organizationId} UNION SELECT catalog_product_id FROM market_members WHERE organization_id=${organizationId} AND left_at IS NULL)
    SELECT COALESCE(cp.brand, 'Unbranded / unavailable') AS brand, count(*)::bigint AS "productCount", percentile_disc(0.5) WITHIN GROUP (ORDER BY po.featured_price) AS "medianPrice"
    FROM scoped JOIN catalog_products cp ON cp.id=scoped.id LEFT JOIN LATERAL (SELECT po.featured_price FROM listing_candidates lc JOIN enrichment_items ei ON ei.supplier_row_id=lc.supplier_row_id JOIN provider_observations po ON po.enrichment_item_id=ei.id WHERE lc.organization_id=${organizationId} AND lc.catalog_product_id=cp.id AND po.metric_type='PRICING' ORDER BY po.observed_at DESC LIMIT 1) po ON true
    GROUP BY cp.brand ORDER BY "productCount" DESC, brand ASC LIMIT 100`);
}
