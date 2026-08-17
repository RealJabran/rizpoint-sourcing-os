CREATE TABLE "listing_quality_assessments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL,
  "rule_version" TEXT NOT NULL,
  "current_snapshot" JSONB NOT NULL,
  "draft_snapshot" JSONB NOT NULL,
  "report" JSONB NOT NULL,
  "evidence_refs" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listing_quality_assessments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "listing_quality_assessments_product_history" ON "listing_quality_assessments"("organization_id", "catalog_product_id", "calculated_at");
ALTER TABLE "listing_quality_assessments" ADD CONSTRAINT "listing_quality_assessments_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "listing_quality_assessments" ADD CONSTRAINT "listing_quality_assessments_product" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
