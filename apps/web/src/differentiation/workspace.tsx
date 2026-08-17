"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, TextInput } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Brief = {
  evidence: Array<{
    themeId: string;
    label: string;
    reviewCount: number;
    averageRating: string | null;
    evidenceReviewIds: string[];
  }>;
  hypotheses: Array<{
    label: string;
    recommendation: string;
    validationQuestion: string;
    confidence: "LOW" | "MEDIUM";
    supportingSignals: string[];
    evidenceReviewIds: string[];
  }>;
  missingInputs: string[];
};

export function DifferentiationWorkspace() {
  const [productId, setProductId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function load() {
    const response = await fetch(
      `/api/differentiation?productId=${encodeURIComponent(productId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error);
      return;
    }
    setBrief(body);
    setMessage(null);
  }
  async function exportBrief() {
    const response = await fetch("/api/differentiation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogProductId: productId, projectId }),
    });
    const body = await response.json();
    setMessage(
      response.ok ? `Brief saved to project note ${body.noteId}.` : body.error,
    );
  }
  return (
    <main className="content-page">
      <PageHeader
        title="Product Differentiation"
        description="Evidence-led supplier-validation hypotheses, never unsupported product claims."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Differentiation" },
        ]}
      />
      <Alert tone="warning" title="Evidence is not a launch claim">
        Recommendations below are hypotheses to validate. They cite authorized
        review evidence and avoid medical, safety, legal, patent, or trademark
        claims.
      </Alert>
      <Card>
        <label htmlFor="diff-product">Catalog product ID</label>
        <div className="inline-actions">
          <TextInput
            id="diff-product"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            placeholder="Known research product ID"
          />
          <Button type="button" onClick={load} disabled={!productId.trim()}>
            Build brief
          </Button>
        </div>
        <label htmlFor="diff-project">Research project ID (export)</label>
        <div className="inline-actions">
          <TextInput
            id="diff-project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder="Target ResearchProject ID"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={exportBrief}
            disabled={!brief || !projectId.trim()}
          >
            Save brief to project
          </Button>
        </div>
        {message ? <p role="status">{message}</p> : null}
      </Card>
      <Card>
        <h2>Evidence</h2>
        {brief?.evidence.length ? (
          <ul>
            {brief.evidence.map((item) => (
              <li key={item.themeId}>
                <strong>{item.label}</strong>: {item.reviewCount} linked
                review(s), rating {item.averageRating ?? "unavailable"}.
                Evidence IDs: {item.evidenceReviewIds.join(", ") || "none"}
              </li>
            ))}
          </ul>
        ) : (
          <p>Build a brief after ingesting and theming authorized reviews.</p>
        )}
      </Card>
      <Card>
        <h2>Hypotheses to validate</h2>
        {brief?.hypotheses.length ? (
          <ul>
            {brief.hypotheses.map((item) => (
              <li key={item.label}>
                <Badge
                  tone={item.confidence === "MEDIUM" ? "warning" : "neutral"}
                >
                  HYPOTHESIS · {item.confidence}
                </Badge>
                <p>{item.recommendation}</p>
                <p>
                  <strong>Supplier validation:</strong>{" "}
                  {item.validationQuestion}
                </p>
                <small>
                  Signals: {item.supportingSignals.join("; ")} · evidence:{" "}
                  {item.evidenceReviewIds.join(", ") || "none"}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No hypotheses without evidence-linked themes.</p>
        )}
      </Card>
      {brief?.missingInputs.length ? (
        <Card>
          <h2>Still unavailable</h2>
          <ul>
            {brief.missingInputs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
