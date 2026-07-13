"use client";

import { useEffect, useState } from "react";

type ProfitResult = {
  id: string;
  status: string;
  recommendation: string | null;
  currentNetProfit: string | null;
  conservativeNetProfit: string | null;
  stressNetProfit: string | null;
  effectiveCogs: string | null;
  amazonFees: string | null;
  roiPercent: string | null;
  marginPercent: string | null;
  breakEvenPrice: string | null;
  reasonCodes: string[];
  evidence: unknown;
  supplierRow: { sourceRowNumber: number };
  shippingRoute: { name: string; currency: string };
};

export default function ProfitPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const [results, setResults] = useState<ProfitResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then(async ({ scanId }) => {
      const response = await fetch(`/api/scans/${scanId}/profit`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError("Unable to load profit results.");
        return;
      }
      setResults((await response.json()) as ProfitResult[]);
    });
  }, [params]);

  return (
    <main>
      <h1>Profit evidence</h1>
      {error ? <p role="alert">{error}</p> : null}
      {results.length === 0 ? (
        <p>
          No calculation results are available yet. Configure a policy and
          route, then calculate.
        </p>
      ) : null}
      <ul>
        {results.map((result) => (
          <li key={result.id}>
            <strong>Row {result.supplierRow.sourceRowNumber}</strong> —{" "}
            {result.recommendation ?? result.status}
            <p>
              Route: {result.shippingRoute.name} (
              {result.shippingRoute.currency}) · COGS{" "}
              {result.effectiveCogs ?? "—"} · Fees {result.amazonFees ?? "—"} ·
              Conservative net {result.conservativeNetProfit ?? "—"} · Stress
              net {result.stressNetProfit ?? "—"}
            </p>
            <p>
              ROI {result.roiPercent ?? "—"}% · Margin{" "}
              {result.marginPercent ?? "—"}% · Break-even{" "}
              {result.breakEvenPrice ?? "—"}
            </p>
            <p>Rules: {result.reasonCodes.join(", ") || "None"}</p>
            <details>
              <summary>Complete evidence</summary>
              <pre>{JSON.stringify(result.evidence, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
    </main>
  );
}
