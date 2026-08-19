CREATE TYPE "DecisionMemoOutcome" AS ENUM ('GO', 'NO_GO', 'HOLD');

CREATE TABLE "project_evidence_references" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL,
  "source_description" TEXT,
  "observed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_evidence_references_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_evidence_references_id_organization_id_key" ON "project_evidence_references"("id", "organization_id");
CREATE INDEX "project_evidence_references_organization_id_project_id_created_at_idx" ON "project_evidence_references"("organization_id", "project_id", "created_at");

CREATE TABLE "project_assumptions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "source_reference" TEXT,
  "assumed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_assumptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_assumptions_id_organization_id_key" ON "project_assumptions"("id", "organization_id");
CREATE INDEX "project_assumptions_organization_id_project_id_assumed_at_idx" ON "project_assumptions"("organization_id", "project_id", "assumed_at");

CREATE TABLE "decision_memos" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "thesis" TEXT NOT NULL,
  "outcome" "DecisionMemoOutcome" NOT NULL,
  "decision_owner" TEXT NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL,
  "sections" JSONB NOT NULL,
  "source_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_memos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_memos_id_organization_id_key" ON "decision_memos"("id", "organization_id");
CREATE INDEX "decision_memos_organization_id_project_id_decided_at_idx" ON "decision_memos"("organization_id", "project_id", "decided_at");

CREATE TABLE "decision_memo_sources" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "decision_memo_id" TEXT NOT NULL,
  "evidence_reference_id" TEXT,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_memo_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_memo_sources_decision_memo_id_source_type_source_id_key" ON "decision_memo_sources"("decision_memo_id", "source_type", "source_id");
CREATE INDEX "decision_memo_sources_organization_id_decision_memo_id_idx" ON "decision_memo_sources"("organization_id", "decision_memo_id");
CREATE INDEX "decision_memo_sources_organization_id_evidence_reference_id_idx" ON "decision_memo_sources"("organization_id", "evidence_reference_id");

ALTER TABLE "project_evidence_references" ADD CONSTRAINT "project_evidence_references_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_evidence_references" ADD CONSTRAINT "project_evidence_references_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_assumptions" ADD CONSTRAINT "project_assumptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_assumptions" ADD CONSTRAINT "project_assumptions_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_memos" ADD CONSTRAINT "decision_memos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_memos" ADD CONSTRAINT "decision_memos_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_memo_sources" ADD CONSTRAINT "decision_memo_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_memo_sources" ADD CONSTRAINT "decision_memo_sources_decision_memo_id_organization_id_fkey" FOREIGN KEY ("decision_memo_id", "organization_id") REFERENCES "decision_memos"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_memo_sources" ADD CONSTRAINT "decision_memo_sources_evidence_reference_id_organization_id_fkey" FOREIGN KEY ("evidence_reference_id", "organization_id") REFERENCES "project_evidence_references"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
