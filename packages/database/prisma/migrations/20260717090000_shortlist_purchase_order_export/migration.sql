CREATE TYPE "ShortlistStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ShortlistItemStatus" AS ENUM ('RESEARCH', 'REVIEW', 'READY_FOR_PO', 'ON_HOLD', 'REJECTED', 'ORDERED');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'VALIDATED', 'EXPORTED', 'CANCELLED');
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX');
CREATE TYPE "ExportKind" AS ENUM ('SHORTLIST', 'PURCHASE_ORDER', 'AUDIT_REPORT');

ALTER TABLE "outbox_events" ALTER COLUMN "scan_job_id" DROP NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN "export_job_id" TEXT;

CREATE TABLE "shortlists" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "status" "ShortlistStatus" NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "shortlists_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "shortlist_items" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "shortlist_id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL, "profit_result_id" TEXT NOT NULL,
  "status" "ShortlistItemStatus" NOT NULL DEFAULT 'RESEARCH', "owner_reference" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "shortlist_items_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "shortlist_notes" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "shortlist_item_id" TEXT NOT NULL,
  "body" TEXT NOT NULL, "author_reference" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "shortlist_notes_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "purchase_orders" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "supplier_id" TEXT NOT NULL,
  "shortlist_id" TEXT, "shipping_route_id" TEXT NOT NULL, "scenario_type" "ProfitScenarioType" NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT', "currency" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
  "budget_amount" DECIMAL(18,4), "minimum_order_amount" DECIMAL(18,4),
  "supplier_subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0, "landed_cost_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "projected_revenue_total" DECIMAL(18,4) NOT NULL DEFAULT 0, "amazon_fee_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "projected_profit_total" DECIMAL(18,4) NOT NULL DEFAULT 0, "validated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "purchase_order_lines" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "purchase_order_id" TEXT NOT NULL,
  "shortlist_item_id" TEXT NOT NULL, "supplier_row_id" TEXT NOT NULL, "profit_result_id" TEXT NOT NULL,
  "requested_units" INTEGER NOT NULL, "case_pack" INTEGER NOT NULL,
  "minimum_order_cases" INTEGER NOT NULL DEFAULT 1, "order_multiple_cases" INTEGER NOT NULL DEFAULT 1,
  "ordered_cases" INTEGER NOT NULL, "ordered_sellable_units" INTEGER NOT NULL,
  "supplier_unit_cost" DECIMAL(18,4) NOT NULL, "scenario_price" DECIMAL(18,4) NOT NULL,
  "scenario_effective_cogs" DECIMAL(18,4) NOT NULL, "scenario_amazon_fee" DECIMAL(18,4) NOT NULL,
  "scenario_net_profit" DECIMAL(18,4) NOT NULL, "supplier_total" DECIMAL(18,4) NOT NULL,
  "landed_cost_total" DECIMAL(18,4) NOT NULL, "projected_revenue_total" DECIMAL(18,4) NOT NULL,
  "amazon_fee_total" DECIMAL(18,4) NOT NULL, "projected_profit_total" DECIMAL(18,4) NOT NULL,
  "source_snapshot" JSONB NOT NULL, "warnings" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_lines_positive_quantities" CHECK ("requested_units" > 0 AND "case_pack" > 0 AND "minimum_order_cases" > 0 AND "order_multiple_cases" > 0 AND "ordered_cases" > 0 AND "ordered_sellable_units" = "ordered_cases" * "case_pack")
);
CREATE TABLE "export_jobs" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "shortlist_id" TEXT, "purchase_order_id" TEXT,
  "kind" "ExportKind" NOT NULL, "format" "ExportFormat" NOT NULL, "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
  "source_revision" INTEGER NOT NULL, "idempotency_key" TEXT NOT NULL, "object_key" TEXT,
  "filename" TEXT, "content_type" TEXT, "checksum_sha256" TEXT, "byte_size" INTEGER,
  "generator_version" TEXT, "attempt_count" INTEGER NOT NULL DEFAULT 0, "failure_code" TEXT,
  "completed_at" TIMESTAMP(3), "expires_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_source" CHECK (("shortlist_id" IS NOT NULL)::int + ("purchase_order_id" IS NOT NULL)::int = 1)
);
CREATE TABLE "workflow_audit_events" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "entity_type" TEXT NOT NULL, "entity_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL, "revision" INTEGER, "idempotency_key" TEXT, "reason" TEXT, "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "workflow_audit_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_export_job_id_fkey" FOREIGN KEY ("export_job_id") REFERENCES "export_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_one_aggregate" CHECK (("scan_job_id" IS NOT NULL)::int + ("export_job_id" IS NOT NULL)::int = 1);
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_shortlist_id_fkey" FOREIGN KEY ("shortlist_id") REFERENCES "shortlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_profit_result_id_fkey" FOREIGN KEY ("profit_result_id") REFERENCES "profit_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shortlist_notes" ADD CONSTRAINT "shortlist_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shortlist_notes" ADD CONSTRAINT "shortlist_notes_shortlist_item_id_fkey" FOREIGN KEY ("shortlist_item_id") REFERENCES "shortlist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_shortlist_id_fkey" FOREIGN KEY ("shortlist_id") REFERENCES "shortlists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_shipping_route_id_fkey" FOREIGN KEY ("shipping_route_id") REFERENCES "shipping_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_shortlist_item_id_fkey" FOREIGN KEY ("shortlist_item_id") REFERENCES "shortlist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_profit_result_id_fkey" FOREIGN KEY ("profit_result_id") REFERENCES "profit_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_shortlist_id_fkey" FOREIGN KEY ("shortlist_id") REFERENCES "shortlists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_audit_events" ADD CONSTRAINT "workflow_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "shortlists_organization_id_name_key" ON "shortlists"("organization_id", "name");
CREATE UNIQUE INDEX "shortlist_items_shortlist_id_supplier_row_id_key" ON "shortlist_items"("shortlist_id", "supplier_row_id");
CREATE UNIQUE INDEX "purchase_orders_organization_id_idempotency_key_key" ON "purchase_orders"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_shortlist_item_id_key" ON "purchase_order_lines"("purchase_order_id", "shortlist_item_id");
CREATE UNIQUE INDEX "export_jobs_organization_id_idempotency_key_key" ON "export_jobs"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "export_jobs_object_key_key" ON "export_jobs"("object_key");
CREATE UNIQUE INDEX "workflow_audit_events_organization_id_idempotency_key_key" ON "workflow_audit_events"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "outbox_events_export_job_id_event_type_key" ON "outbox_events"("export_job_id", "event_type");
CREATE INDEX "shortlists_organization_id_status_updated_at_idx" ON "shortlists"("organization_id", "status", "updated_at");
CREATE INDEX "shortlist_items_organization_id_shortlist_id_status_idx" ON "shortlist_items"("organization_id", "shortlist_id", "status");
CREATE INDEX "shortlist_notes_organization_id_shortlist_item_id_created_at_idx" ON "shortlist_notes"("organization_id", "shortlist_item_id", "created_at");
CREATE INDEX "purchase_orders_organization_id_supplier_id_status_updated_at_idx" ON "purchase_orders"("organization_id", "supplier_id", "status", "updated_at");
CREATE INDEX "purchase_order_lines_organization_id_purchase_order_id_idx" ON "purchase_order_lines"("organization_id", "purchase_order_id");
CREATE INDEX "export_jobs_organization_id_status_created_at_idx" ON "export_jobs"("organization_id", "status", "created_at");
CREATE INDEX "workflow_audit_events_organization_id_entity_type_entity_id_created_at_idx" ON "workflow_audit_events"("organization_id", "entity_type", "entity_id", "created_at");
