"use client";
import { useState } from "react";
import { Alert, Button, Card, TextInput } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Answer = {
  operation: string;
  facts: Array<{ text: string; citationId: string; observedAt?: string }>;
  derived: string[];
  hypotheses: string[];
  missing: string[];
  safeguards: string[];
};
export function ResearchCopilotWorkspace() {
  const [question, setQuestion] = useState(
    "Find niches with stable demand and low review barriers",
  );
  const [projectId, setProjectId] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/research-copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, ...(projectId ? { projectId } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setAnswer(j.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "COPILOT_FAILED");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-stack">
      <PageHeader
        title="Research Copilot"
        description="Evidence-only answers from tenant-scoped RizPoint records."
      />
      <Alert tone="warning" title="AI provider not configured">
        This safe retrieval mode does not invent a narrative. Configure an
        approved model later only as an explanation layer.
      </Alert>
      <Card>
        <div className="page-stack">
          <TextInput
            aria-label="Research question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <TextInput
            aria-label="Optional project ID"
            placeholder="Optional project ID"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          />
          <Button onClick={ask} disabled={busy}>
            {busy ? "Retrieving…" : "Ask using verified data"}
          </Button>
        </div>
      </Card>
      {error ? (
        <Alert tone="danger" title="Copilot error">
          {error}
        </Alert>
      ) : null}
      {answer ? (
        <Card>
          <h2>{answer.operation}</h2>
          <h3>Facts with evidence IDs</h3>
          {answer.facts.map((f) => (
            <p key={f.citationId}>
              {f.text} <code>{f.citationId}</code>
            </p>
          ))}
          <h3>Derived metric context</h3>
          {answer.derived.map((x) => (
            <p key={x}>{x}</p>
          ))}
          <h3>Missing data</h3>
          {answer.missing.map((x) => (
            <p key={x}>{x}</p>
          ))}
          <h3>Hypotheses</h3>
          {answer.hypotheses.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
