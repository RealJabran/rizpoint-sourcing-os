"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, TextInput } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { ProjectPicker } from "@/src/components/entity-pickers";

type Fact = {
  id: string;
  factKey: string;
  value: string;
  source: string;
  evidenceReference: string;
};
type Draft = {
  id: string;
  version: number;
  status: string;
  content: {
    title: string;
    bullets: string[];
    description: string;
    backendSearchTerms: string[];
    imageBrief: string[];
    aPlusOutline: string[];
    faqIdeas: string[];
  };
  warnings: { keywordStuffing?: string | null };
  claims: Array<{
    id: string;
    section: string;
    phrase: string;
    status: string;
    productFactId: string | null;
    keywordRefs: string[];
  }>;
};
type Data = { facts: Fact[]; drafts: Draft[] };

export function ListingBuilder() {
  const [projectId, setProjectId] = useState("");
  const [factKey, setFactKey] = useState("");
  const [factValue, setFactValue] = useState("");
  const [evidence, setEvidence] = useState("");
  const [keywords, setKeywords] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/listing-builder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error);
      return null;
    }
    return result;
  }
  async function load() {
    const response = await fetch(
      `/api/listing-builder?projectId=${encodeURIComponent(projectId)}`,
    );
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error);
      return;
    }
    setData(result);
    setMessage(null);
  }
  async function addFact() {
    const created = await request({
      action: "CREATE_FACT",
      projectId,
      factKey,
      value: factValue,
      evidenceReference: evidence,
      source: "USER_VERIFIED",
    });
    if (created) {
      setFactKey("");
      setFactValue("");
      setEvidence("");
      await load();
    }
  }
  async function generate() {
    const draft = await request({
      action: "GENERATE",
      projectId,
      keywords: keywords.split(","),
      prohibitedTerms: [],
      categoryConstraints: [],
    });
    if (draft) await load();
  }
  async function approve(draftId: string) {
    const draft = await request({ action: "APPROVE", draftId });
    if (draft) await load();
  }
  return (
    <main className="content-page">
      <PageHeader
        title="Listing Builder"
        description="Versioned listing architecture generated only from verified product facts and target keywords."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Listing builder" },
        ]}
      />
      <Alert tone="warning" title="Fact-bound generation">
        The builder does not invent specifications, certifications, materials,
        dimensions, guarantees, health claims, compatibility, origin, or
        performance. Manual edits are flagged as unverified claims until mapped
        to verified evidence; approval is blocked server-side.
      </Alert>
      <Card>
        <label htmlFor="builder-project">Research project</label>
        <div className="inline-actions">
          <ProjectPicker
            id="builder-project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          />
          <Button type="button" onClick={load} disabled={!projectId.trim()}>
            Load project
          </Button>
        </div>
      </Card>
      <Card>
        <h2>Add verified product fact</h2>
        <TextInput
          value={factKey}
          onChange={(event) => setFactKey(event.target.value)}
          placeholder="Fact key, e.g. material"
          aria-label="Fact key"
        />
        <TextInput
          value={factValue}
          onChange={(event) => setFactValue(event.target.value)}
          placeholder="Verified value"
          aria-label="Verified value"
        />
        <TextInput
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          placeholder="Evidence reference or user verification note"
          aria-label="Evidence reference"
        />
        <Button
          type="button"
          onClick={addFact}
          disabled={!projectId || !factKey || !factValue || !evidence}
        >
          Save verified fact
        </Button>
        {data?.facts.length ? (
          <ul>
            {data.facts.map((fact) => (
              <li key={fact.id}>
                <strong>{fact.factKey}</strong>: {fact.value}{" "}
                <small>
                  ({fact.source}; {fact.evidenceReference})
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No verified facts are loaded.</p>
        )}
      </Card>
      <Card>
        <h2>Generate a fact-bound draft</h2>
        <TextInput
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="Target keywords, comma separated"
          aria-label="Target keywords"
        />
        <Button
          type="button"
          onClick={generate}
          disabled={!projectId || !data?.facts.length}
        >
          Generate next draft version
        </Button>
      </Card>
      {data?.drafts.map((draft) => (
        <Card key={draft.id}>
          <h2>
            Draft v{draft.version}{" "}
            <Badge tone={draft.status === "APPROVED" ? "success" : "warning"}>
              {draft.status}
            </Badge>
          </h2>
          <p>
            <strong>Title:</strong> {draft.content.title}
          </p>
          <p>
            <strong>Bullets:</strong> {draft.content.bullets.join(" · ")}
          </p>
          <p>
            <strong>Description:</strong> {draft.content.description}
          </p>
          <p>
            <strong>Backend terms:</strong>{" "}
            {draft.content.backendSearchTerms.join(", ")}
          </p>
          <p>
            <strong>Image brief:</strong> {draft.content.imageBrief.join(" · ")}
          </p>
          <p>
            <strong>A+ outline:</strong>{" "}
            {draft.content.aPlusOutline.join(" · ")}
          </p>
          <p>
            <strong>FAQ ideas:</strong> {draft.content.faqIdeas.join(" · ")}
          </p>
          {draft.warnings.keywordStuffing ? (
            <p role="alert">
              Keyword stuffing warning: {draft.warnings.keywordStuffing}
            </p>
          ) : null}
          <h3>Claim / evidence map</h3>
          <ul>
            {draft.claims.map((claim) => (
              <li key={claim.id}>
                <Badge
                  tone={claim.status === "VERIFIED" ? "success" : "danger"}
                >
                  {claim.status}
                </Badge>{" "}
                {claim.section}: “{claim.phrase}”{" "}
                {claim.productFactId
                  ? `→ fact ${claim.productFactId}`
                  : "→ no fact mapped"}{" "}
                {claim.keywordRefs.length
                  ? `(keywords: ${claim.keywordRefs.join(", ")})`
                  : ""}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={() => approve(draft.id)}
            disabled={draft.status === "APPROVED"}
          >
            Approve verified draft
          </Button>
        </Card>
      ))}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
