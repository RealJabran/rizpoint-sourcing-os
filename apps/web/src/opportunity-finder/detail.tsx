"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Component = {
  key: string;
  label: string;
  score: string | null;
  explanation: string;
  observedCount: number;
};
type Detail = {
  name: string;
  assessment: {
    status: string;
    score: string | null;
    confidencePercent: string | null;
    calculationVersion: string;
    components: { components: Component[] };
    inputEvidenceReferences: unknown[];
    thresholdConfiguration: unknown;
  } | null;
};
export function NicheDetail() {
  const { nicheId } = useParams<{ nicheId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  useEffect(() => {
    void fetch(`/api/opportunity-finder/${nicheId}`)
      .then((r) => r.json())
      .then(setData);
  }, [nicheId]);
  if (!data)
    return (
      <main className="content-page">
        <Card>Loading niche…</Card>
      </main>
    );
  const a = data.assessment;
  return (
    <main className="content-page">
      <PageHeader
        title={data.name}
        description="Deterministic niche assessment over stored inputs."
        breadcrumbs={[
          { label: "Opportunity Finder", href: "/opportunity-finder" },
          { label: data.name },
        ]}
      />
      {!a ? (
        <Alert tone="warning" title="Not calculated">
          No stored assessment is available.
        </Alert>
      ) : (
        <>
          <Alert
            tone={a.status === "COMPLETE" ? "success" : "warning"}
            title={`Score ${a.score ?? "unavailable"} · confidence ${a.confidencePercent ?? "0"}%`}
          >
            Version {a.calculationVersion}; inputs and configured thresholds are
            retained with this immutable assessment.
          </Alert>
          <Card>
            <h2>Component scores</h2>
            <ul>
              {a.components.components.map((c) => (
                <li key={c.key}>
                  <strong>
                    {c.label}: {c.score ?? "unavailable"}
                  </strong>{" "}
                  — {c.explanation} ({c.observedCount} observed)
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2>Why data is limited</h2>
            <p>
              Inputs: {a.inputEvidenceReferences.length} product/history
              references. Thresholds: {JSON.stringify(a.thresholdConfiguration)}
              .
            </p>
            <p>
              Demand, revenue, BSR stability, seller concentration, sponsored
              density, margin potential, and differentiation beyond observed
              competition remain unavailable without licensed or user-supplied
              evidence.
            </p>
          </Card>
        </>
      )}
    </main>
  );
}
