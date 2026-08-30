CREATE TABLE "amazon_deployment_security_snapshots" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "deployment_id" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "verifier_version" INTEGER NOT NULL,
  "overall_status" TEXT NOT NULL,
  "report_digest" TEXT NOT NULL,
  "signer_fingerprint" TEXT NOT NULL,
  "controls" JSONB NOT NULL,
  "public_certificate_expires_at" TIMESTAMP(3),
  "imported_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "amazon_deployment_security_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "amazon_deployment_security_snapshots_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "amazon_deployment_security_snapshots_organization_id_report_digest_key"
  ON "amazon_deployment_security_snapshots"("organization_id", "report_digest");
CREATE INDEX "amazon_deployment_security_org_observed_idx"
  ON "amazon_deployment_security_snapshots"("organization_id", "observed_at" DESC);
