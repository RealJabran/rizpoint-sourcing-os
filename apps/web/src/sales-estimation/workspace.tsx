"use client";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  TextInput,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Estimate = {
  status: "AVAILABLE" | "UNAVAILABLE";
  source: "LICENSED_PROVIDER" | "RIZPOINT_CALIBRATED_MODEL" | "NONE";
  monthlyUnitsLow?: string;
  monthlyUnitsCentral?: string;
  monthlyUnitsHigh?: string;
  confidencePercent?: string;
  modelVersion?: string;
  provenanceReferences: string[];
  reasonCode?: string;
};
export function SalesEstimationWorkspace() {
  const { notify } = useToast();
  const [asin, setAsin] = useState("");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    const response = await fetch("/api/sales-estimation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asin }),
    });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok)
      return notify(payload?.error ?? "Estimate request failed", "danger");
    setEstimate(payload);
  };
  return (
    <main className="content-page">
      <PageHeader
        title="Sales estimation"
        description="Monthly unit ranges only from licensed estimates or validated marketplace/category calibration."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Sales estimation" },
        ]}
      />
      <Alert tone="info" title="No universal BSR-to-sales formula">
        Rank is accepted only by an exact, validated calibration model. Missing
        models, sparse history, category mismatch, and unsupported ranks return
        no estimate.
      </Alert>
      <Card className="explorer-controls">
        <div className="explorer-filter-grid">
          <TextInput
            aria-label="ASIN"
            placeholder="B000000000"
            value={asin}
            onChange={(event) => setAsin(event.target.value.toUpperCase())}
          />
          <Button loading={loading} onClick={() => void run()}>
            Estimate monthly units
          </Button>
        </div>
      </Card>
      {estimate ? (
        estimate.status === "AVAILABLE" ? (
          <Card>
            <Badge tone="success">
              {estimate.source === "LICENSED_PROVIDER"
                ? "Licensed provider estimate"
                : "RizPoint calibrated model"}
            </Badge>
            <h2>
              {estimate.monthlyUnitsLow}–{estimate.monthlyUnitsHigh} units/month
            </h2>
            {estimate.monthlyUnitsCentral ? (
              <p>
                Central estimate: {estimate.monthlyUnitsCentral}; use the
                interval for decisions.
              </p>
            ) : null}
            <dl>
              <dt>Confidence</dt>
              <dd>{estimate.confidencePercent ?? "Not supplied"}%</dd>
              <dt>Model version</dt>
              <dd>{estimate.modelVersion}</dd>
              <dt>Input provenance</dt>
              <dd>{estimate.provenanceReferences.length} stored references</dd>
            </dl>
          </Card>
        ) : (
          <Alert tone="warning" title="No defensible estimate available">
            {estimate.reasonCode}. No value was substituted.
          </Alert>
        )
      ) : (
        <Card className="empty-state">
          <h2>No estimate requested</h2>
          <p>
            Enter an ASIN already present in your organization’s evidence
            universe.
          </p>
        </Card>
      )}
    </main>
  );
}
