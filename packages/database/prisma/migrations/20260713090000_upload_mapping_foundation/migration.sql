ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'UPLOADED';
ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'MAPPING_REQUIRED';
ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'NORMALIZING';

CREATE TYPE "UploadStatus" AS ENUM ('PENDING_UPLOAD', 'QUARANTINED', 'INSPECTING', 'MAPPING_REQUIRED', 'READY', 'NORMALIZING', 'COMPLETED', 'REJECTED');
CREATE TYPE "MalwareScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');
CREATE TYPE "FileFormat" AS ENUM ('CSV', 'XLS', 'XLSX');
CREATE TYPE "MappingTarget" AS ENUM ('ASIN', 'UPC', 'EAN', 'GTIN', 'ITEM_NUMBER', 'DESCRIPTION', 'BRAND', 'UNIT_COST', 'CURRENCY', 'QUANTITY', 'CASE_COUNT', 'PACK_COUNT', 'WEIGHT', 'LENGTH', 'WIDTH', 'HEIGHT');
CREATE TYPE "NormalizationStatus" AS ENUM ('PENDING', 'NORMALIZED', 'WARNING', 'INVALID');
CREATE TYPE "WarningSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

ALTER TABLE "scan_jobs"
  ADD COLUMN "supplier_id" TEXT,
  ADD COLUMN "upload_id" TEXT,
  ADD COLUMN "job_type" TEXT NOT NULL DEFAULT 'MOCK';

CREATE TABLE "suppliers" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_vsi_preset" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "uploads" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "declared_media_type" TEXT,
  "detected_format" "FileFormat",
  "byte_size" INTEGER,
  "checksum_sha256" TEXT,
  "status" "UploadStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "malware_status" "MalwareScanStatus" NOT NULL DEFAULT 'PENDING',
  "rejection_code" TEXT,
  "inspected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "upload_sheets" (
  "id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "sheet_index" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL,
  "column_count" INTEGER NOT NULL,
  "header_candidates" JSONB NOT NULL,
  "selected_header_row" INTEGER,
  "columns" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "upload_sheets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sheet_profiles" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "file_format" "FileFormat",
  "sheet_name" TEXT,
  "header_row" INTEGER NOT NULL,
  "mapping" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sheet_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "column_mappings" (
  "id" TEXT NOT NULL,
  "scan_job_id" TEXT NOT NULL,
  "source_index" INTEGER NOT NULL,
  "source_column" TEXT NOT NULL,
  "target" "MappingTarget" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "column_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_rows" (
  "id" TEXT NOT NULL,
  "scan_job_id" TEXT NOT NULL,
  "upload_sheet_id" TEXT NOT NULL,
  "source_row_number" INTEGER NOT NULL,
  "raw_data" JSONB NOT NULL,
  "row_checksum" TEXT NOT NULL,
  "normalization_status" "NormalizationStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "normalized_offers" (
  "id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "asin" TEXT,
  "upc" TEXT,
  "ean" TEXT,
  "gtin" TEXT,
  "item_number" TEXT,
  "description" TEXT,
  "brand" TEXT,
  "unit_cost" DECIMAL(18,4),
  "currency" TEXT,
  "quantity" INTEGER,
  "case_count" INTEGER,
  "pack_count" INTEGER,
  "weight" DECIMAL(18,4),
  "length" DECIMAL(18,4),
  "width" DECIMAL(18,4),
  "height" DECIMAL(18,4),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "normalized_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "normalization_warnings" (
  "id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "severity" "WarningSeverity" NOT NULL,
  "field" TEXT,
  "context" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "normalization_warnings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scan_jobs_upload_id_key" ON "scan_jobs"("upload_id");
CREATE INDEX "scan_jobs_organization_id_supplier_id_idx" ON "scan_jobs"("organization_id", "supplier_id");
CREATE UNIQUE INDEX "suppliers_organization_id_code_key" ON "suppliers"("organization_id", "code");
CREATE INDEX "suppliers_organization_id_name_idx" ON "suppliers"("organization_id", "name");
CREATE UNIQUE INDEX "uploads_object_key_key" ON "uploads"("object_key");
CREATE INDEX "uploads_organization_id_status_idx" ON "uploads"("organization_id", "status");
CREATE INDEX "uploads_supplier_id_created_at_idx" ON "uploads"("supplier_id", "created_at");
CREATE UNIQUE INDEX "upload_sheets_upload_id_sheet_index_key" ON "upload_sheets"("upload_id", "sheet_index");
CREATE UNIQUE INDEX "sheet_profiles_supplier_id_name_key" ON "sheet_profiles"("supplier_id", "name");
CREATE UNIQUE INDEX "column_mappings_scan_job_id_target_key" ON "column_mappings"("scan_job_id", "target");
CREATE UNIQUE INDEX "column_mappings_scan_job_id_source_index_key" ON "column_mappings"("scan_job_id", "source_index");
CREATE UNIQUE INDEX "supplier_rows_scan_job_id_source_row_number_key" ON "supplier_rows"("scan_job_id", "source_row_number");
CREATE INDEX "supplier_rows_scan_job_id_normalization_status_idx" ON "supplier_rows"("scan_job_id", "normalization_status");
CREATE UNIQUE INDEX "normalized_offers_supplier_row_id_key" ON "normalized_offers"("supplier_row_id");
CREATE INDEX "normalized_offers_upc_idx" ON "normalized_offers"("upc");
CREATE INDEX "normalized_offers_ean_idx" ON "normalized_offers"("ean");
CREATE UNIQUE INDEX "normalization_warnings_supplier_row_id_code_field_key" ON "normalization_warnings"("supplier_row_id", "code", "field");

ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upload_sheets" ADD CONSTRAINT "upload_sheets_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sheet_profiles" ADD CONSTRAINT "sheet_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sheet_profiles" ADD CONSTRAINT "sheet_profiles_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "column_mappings" ADD CONSTRAINT "column_mappings_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_rows" ADD CONSTRAINT "supplier_rows_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_rows" ADD CONSTRAINT "supplier_rows_upload_sheet_id_fkey" FOREIGN KEY ("upload_sheet_id") REFERENCES "upload_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "normalized_offers" ADD CONSTRAINT "normalized_offers_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "normalization_warnings" ADD CONSTRAINT "normalization_warnings_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
