ALTER TABLE "sales_estimates" DROP CONSTRAINT IF EXISTS "sales_estimates_model_fkey";
ALTER TABLE "sales_estimates" DROP CONSTRAINT IF EXISTS "sales_estimates_catalog_product_fkey";
ALTER TABLE "sales_estimates" DROP CONSTRAINT IF EXISTS "sales_estimates_organization_fkey";
ALTER TABLE "sales_estimation_models" DROP CONSTRAINT IF EXISTS "sales_estimation_models_organization_fkey";
DROP TABLE IF EXISTS "sales_estimates";
DROP TABLE IF EXISTS "sales_estimation_models";
DROP TYPE IF EXISTS "SalesEstimateSource";
DROP TYPE IF EXISTS "SalesEstimationModelStatus";
