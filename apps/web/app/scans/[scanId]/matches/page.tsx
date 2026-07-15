"use client";

import { useEffect, useState } from "react";

type Decision = {
  id: string;
  status: string;
  confidence: number;
  reasonCodes: string[];
  supplierRow: {
    id: string;
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
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>(
    {},
  );

  async function review(
    supplierRowId: string,
    status: "USER_ACCEPTED" | "USER_REJECTED",
    selectedCandidateId: string | null,
    reason: string,
  ): Promise<void> {
    if (reason.trim().length < 3) {
      setError("Add a brief reason before recording a match review.");
      return;
    }
    const response = await fetch(
      `/api/supplier-rows/${supplierRowId}/match-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          selectedCandidateId,
          reason: reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    );
    if (!response.ok) {
      setError("Unable to save the match review.");
      return;
    }
    setDecisions((current) =>
      current.map((decision) =>
        decision.supplierRow.id === supplierRowId
          ? { ...decision, status }
          : decision,
      ),
    );
  }

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
            <label>
              Review reason{" "}
              <input
                value={reviewReasons[decision.supplierRow.id] ?? ""}
                maxLength={500}
                onChange={(event) =>
                  setReviewReasons((current) => ({
                    ...current,
                    [decision.supplierRow.id]: event.target.value,
                  }))
                }
              />
            </label>
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
                  <button
                    type="button"
                    onClick={() =>
                      void review(
                        decision.supplierRow.id,
                        "USER_ACCEPTED",
                        candidate.id,
                        reviewReasons[decision.supplierRow.id] ?? "",
                      )
                    }
                  >
                    Accept candidate
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                void review(
                  decision.supplierRow.id,
                  "USER_REJECTED",
                  null,
                  reviewReasons[decision.supplierRow.id] ?? "",
                )
              }
            >
              Reject all candidates
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
