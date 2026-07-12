"use client";

import { useEffect, useState } from "react";

type Decision = {
  id: string;
  status: string;
  confidence: number;
  reasonCodes: string[];
  supplierRow: {
    sourceRowNumber: number;
    normalizedOffer: { description: string | null } | null;
    listingCandidates: Array<{
      id: string;
      confidence: number;
      catalogProduct: { asin: string | null; title: string };
      evidence: Array<{ feature: string; outcome: string; reasonCode: string }>;
      packGuard: { status: string; reasonCode: string } | null;
    }>;
  };
  selectedCandidate: {
    id: string;
    catalogProduct: { asin: string | null; title: string };
    packGuard: { status: string; reasonCode: string } | null;
  } | null;
};

export default function MatchesPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then(async ({ scanId }) => {
      const response = await fetch(`/api/scans/${scanId}/matches`, {
        cache: "no-store",
      });
      if (!response.ok) return setError("Unable to load match results.");
      setDecisions((await response.json()) as Decision[]);
    });
  }, [params]);

  return (
    <main>
      <h1>Match review</h1>
      {error ? <p role="alert">{error}</p> : null}
      {decisions.length === 0 ? (
        <p>No match decisions are available yet.</p>
      ) : null}
      <ul>
        {decisions.map((decision) => (
          <li key={decision.id}>
            <strong>Row {decision.supplierRow.sourceRowNumber}</strong>:{" "}
            {decision.status} ({decision.confidence}%)
            <br />
            {decision.supplierRow.normalizedOffer?.description ??
              "No supplier title"}
            <br />
            {decision.selectedCandidate
              ? `${decision.selectedCandidate.catalogProduct.asin ?? "No ASIN"} — ${decision.selectedCandidate.catalogProduct.title}`
              : "No selected candidate"}
            {decision.selectedCandidate?.packGuard ? (
              <p>
                PackGuard: {decision.selectedCandidate.packGuard.status} (
                {decision.selectedCandidate.packGuard.reasonCode})
              </p>
            ) : null}
            <ul>
              {decision.supplierRow.listingCandidates.map((candidate) => (
                <li key={candidate.id}>
                  {candidate.catalogProduct.asin ?? "No ASIN"} —{" "}
                  {candidate.catalogProduct.title} ({candidate.confidence}%)
                  <br />
                  Evidence:{" "}
                  {candidate.evidence
                    .map(
                      (evidence) => `${evidence.feature}: ${evidence.outcome}`,
                    )
                    .join(", ")}
                  {candidate.packGuard ? (
                    <span> — PackGuard: {candidate.packGuard.status}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
