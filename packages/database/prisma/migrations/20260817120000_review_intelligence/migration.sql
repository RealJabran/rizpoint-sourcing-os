CREATE TYPE "AuthorizedReviewSource" AS ENUM ('LICENSED_PROVIDER', 'USER_IMPORT', 'AUTHORIZED_OTHER');
CREATE TYPE "ReviewThemeKind" AS ENUM ('COMPLAINT', 'PRAISE', 'QUALITY', 'SIZING_COMPATIBILITY', 'PACKAGING', 'MISSING_FEATURE', 'DURABILITY', 'INSTRUCTIONS');

CREATE TABLE "authorized_reviews" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL,
  "source" "AuthorizedReviewSource" NOT NULL,
  "source_reference" TEXT NOT NULL,
  "dedupe_hash" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "normalized_language" TEXT NOT NULL DEFAULT 'und',
  "body_redacted" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "authorized_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "authorized_reviews_dedupe" ON "authorized_reviews"("organization_id", "source", "dedupe_hash");
CREATE INDEX "authorized_reviews_product_history" ON "authorized_reviews"("organization_id", "catalog_product_id", "observed_at");
ALTER TABLE "authorized_reviews" ADD CONSTRAINT "authorized_reviews_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorized_reviews" ADD CONSTRAINT "authorized_reviews_product" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "review_themes" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL,
  "kind" "ReviewThemeKind" NOT NULL,
  "label" TEXT NOT NULL,
  "review_count" INTEGER NOT NULL,
  "average_rating" DECIMAL(4,2),
  "evidence_review_ids" JSONB NOT NULL,
  "method_version" TEXT NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "review_themes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "review_themes_subject_kind_label" ON "review_themes"("organization_id", "catalog_product_id", "kind", "label");
CREATE INDEX "review_themes_product_history" ON "review_themes"("organization_id", "catalog_product_id", "calculated_at");
ALTER TABLE "review_themes" ADD CONSTRAINT "review_themes_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_themes" ADD CONSTRAINT "review_themes_product" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
