"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, TextInput } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { ProductPicker } from "@/src/components/entity-pickers";

type Report = {
  overallScore: number;
  components: Array<{
    key: string;
    label: string;
    score: number | null;
    rule: string;
    state: string;
  }>;
  keywordCoverage: Array<{ keyword: string; present: boolean }>;
  warnings: Array<{
    kind: "SEO_OPPORTUNITY" | "COMPLIANCE_RISK" | "CONTENT_QUALITY";
    message: string;
    priority: string;
  }>;
  actions: Array<{ priority: string; action: string; basis: string }>;
};
type Result = { ruleVersion: string; current: Report; draft: Report };
const split = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

export function ListingAnalyzer() {
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [bullets, setBullets] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [prohibited, setProhibited] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function analyze() {
    setError(null);
    const response = await fetch("/api/listing-analyzer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        catalogProductId: productId,
        title,
        bullets: split(bullets),
        description,
        targetKeywords: keywords.split(","),
        prohibitedTerms: prohibited.split(","),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error);
      return;
    }
    setResult(body);
  }
  return (
    <main className="content-page">
      <PageHeader
        title="Listing Analyzer"
        description="A deterministic, decomposable checklist for an authorized current listing and editable draft."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Listing analyzer" },
        ]}
      />
      <Alert tone="info" title="Checklist, not a ranking promise">
        SEO opportunities are separate from compliance risks. Scores measure the
        stated copy rules only and do not claim Amazon ranking causality;
        unavailable image, A+, and category requirements remain explicit.
      </Alert>
      <Card>
        <label htmlFor="listing-product">Product</label>
        <ProductPicker
          id="listing-product"
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
        />
        <label htmlFor="listing-title">Draft title</label>
        <TextInput
          id="listing-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="listing-bullets">Draft bullets (one per line)</label>
        <textarea
          id="listing-bullets"
          className="rp-input"
          value={bullets}
          onChange={(event) => setBullets(event.target.value)}
        />
        <label htmlFor="listing-description">Draft description</label>
        <textarea
          id="listing-description"
          className="rp-input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label htmlFor="listing-keywords">
          Target keywords (comma separated)
        </label>
        <TextInput
          id="listing-keywords"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
        />
        <label htmlFor="listing-prohibited">
          Prohibited terms (comma separated)
        </label>
        <TextInput
          id="listing-prohibited"
          value={prohibited}
          onChange={(event) => setProhibited(event.target.value)}
        />
        <Button
          type="button"
          onClick={analyze}
          disabled={!productId.trim() || !title.trim()}
        >
          Analyze draft against current
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </Card>
      {result ? (
        <>
          <Card>
            <h2>Current vs draft</h2>
            <p>Rule version: {result.ruleVersion}</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Current</th>
                    <th>Draft</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {result.draft.components.map((component, index) => (
                    <tr key={component.key}>
                      <td>{component.label}</td>
                      <td>
                        {result.current.components[index]?.score ??
                          "Unavailable"}
                      </td>
                      <td>
                        <Badge
                          tone={
                            component.state === "RISK"
                              ? "danger"
                              : component.state === "PASS"
                                ? "success"
                                : "warning"
                          }
                        >
                          {component.score ?? "Unavailable"} · {component.state}
                        </Badge>
                      </td>
                      <td>{component.rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              <strong>Overall:</strong> current {result.current.overallScore} /
              draft {result.draft.overallScore}
            </p>
          </Card>
          <Card>
            <h2>Keyword coverage</h2>
            {result.draft.keywordCoverage.length ? (
              <ul>
                {result.draft.keywordCoverage.map((item) => (
                  <li key={item.keyword}>
                    {item.keyword}: {item.present ? "present" : "missing"}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No target keywords supplied; coverage is unavailable.</p>
            )}
          </Card>
          <Card>
            <h2>Prioritized actions</h2>
            {result.draft.actions.length ? (
              <ul>
                {result.draft.actions.map((action, index) => (
                  <li key={`${action.action}-${index}`}>
                    <Badge
                      tone={
                        action.basis === "COMPLIANCE_RISK"
                          ? "danger"
                          : "warning"
                      }
                    >
                      {action.priority} · {action.basis}
                    </Badge>{" "}
                    {action.action}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No deterministic actions were raised.</p>
            )}
          </Card>
        </>
      ) : null}
    </main>
  );
}
