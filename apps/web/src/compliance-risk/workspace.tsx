"use client";

import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  SelectControl,
  TextInput,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import {
  MarketplacePicker,
  ProductPicker,
  ProjectPicker,
} from "@/src/components/entity-pickers";

type Evidence = {
  kind: string;
  reference: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourcePublishedAt?: string;
  observedAt?: string;
};
type Result = {
  domain: string;
  riskLevel: "LOW" | "REVIEW" | "HIGH" | "UNKNOWN";
  why: string;
  evidence: Evidence[];
  questionsToAskSupplier: string[];
  likelyDocumentation: string[];
  doNotLaunchUntilVerified: boolean;
};
type RuleSet = {
  id: string;
  name: string;
  version: string;
  marketplaceId: string;
  jurisdiction: string;
  status: string;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  sourceAccessedAt: string;
  rules: Array<{ id: string; domain: string; riskLevel: string }>;
};
type Assessment = {
  id: string;
  calculatedAt: string;
  catalogProduct: { id: string; asin: string | null; title: string } | null;
  ruleSet: Pick<
    RuleSet,
    | "name"
    | "version"
    | "sourceTitle"
    | "sourceUrl"
    | "sourcePublishedAt"
    | "sourceAccessedAt"
  >;
  results: Result[];
};
type Workspace = { ruleSets: RuleSet[]; assessments: Assessment[] };

const exampleRules = JSON.stringify(
  [
    {
      domain: "BATTERY",
      riskLevel: "REVIEW",
      matchTerms: ["battery", "rechargeable", "lithium"],
      rationale:
        "Battery-related terms are a research screening signal and require authoritative review.",
      supplierQuestions: [
        "What battery chemistry and transport information applies to this product?",
      ],
      likelyDocumentation: [
        "Applicable battery and transport documentation, if required by the authoritative source.",
      ],
      authoritativeClearance: false,
      sourceTitle: "Authoritative source title",
      sourceUrl: "https://authoritative-source.example/rule",
      sourcePublishedAt: "2026-08-17T00:00:00.000Z",
    },
  ],
  null,
  2,
);

function badgeTone(level: Result["riskLevel"]) {
  if (level === "HIGH") return "danger" as const;
  if (level === "REVIEW") return "warning" as const;
  if (level === "LOW") return "success" as const;
  return "neutral" as const;
}
function date(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function ComplianceRiskWorkspace() {
  const [projectId, setProjectId] = useState("");
  const [marketplaceId, setMarketplaceId] = useState("");
  const [jurisdiction, setJurisdiction] = useState("US");
  const [catalogProductId, setCatalogProductId] = useState("");
  const [additionalText, setAdditionalText] = useState("");
  const [ruleSetId, setRuleSetId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ruleSetName, setRuleSetName] = useState("Compliance screening");
  const [ruleSetVersion, setRuleSetVersion] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rulesJson, setRulesJson] = useState(exampleRules);

  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/compliance-risk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "COMPLIANCE_RISK_FAILED");
      return null;
    }
    setMessage(null);
    return result;
  }
  async function load() {
    const params = new URLSearchParams();
    if (projectId.trim()) params.set("projectId", projectId.trim());
    if (marketplaceId.trim()) params.set("marketplaceId", marketplaceId.trim());
    if (jurisdiction.trim()) params.set("jurisdiction", jurisdiction.trim());
    const response = await fetch(`/api/compliance-risk?${params.toString()}`);
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "COMPLIANCE_RISK_UNAVAILABLE");
      return;
    }
    setWorkspace(result);
    const active = (result.ruleSets as RuleSet[]).find(
      (item) => item.status === "ACTIVE",
    );
    if (active) setRuleSetId(active.id);
    setMessage(null);
  }
  async function assess() {
    const result = await request({
      action: "ASSESS",
      projectId,
      ruleSetId,
      jurisdiction,
      catalogProductId,
      additionalProductText: additionalText,
    });
    if (result) {
      setAssessment(result);
      await load();
    }
  }
  async function createRuleSet() {
    let rules: unknown;
    try {
      rules = JSON.parse(rulesJson);
    } catch {
      setMessage("RULES_JSON_INVALID");
      return;
    }
    const now = new Date().toISOString();
    const result = await request({
      action: "CREATE_RULESET_VERSION",
      marketplaceId,
      jurisdiction,
      name: ruleSetName,
      version: ruleSetVersion,
      sourceTitle,
      sourceUrl,
      sourcePublishedAt: now,
      sourceAccessedAt: now,
      rules,
    });
    if (result) {
      setRuleSetId(result.id);
      await load();
    }
  }
  const resultToShow = assessment?.results;
  return (
    <main className="content-page">
      <PageHeader
        title="Compliance risk screen"
        description="Research-stage signals from versioned curated rules. It is not legal advice, certification advice, or Amazon selling eligibility clearance."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Compliance risk" },
        ]}
      />
      <Alert tone="warning" title="Verify before launch">
        A LOW screening result is possible only from a configured authoritative
        clearance rule. Every other result, including UNKNOWN, remains “do not
        launch until verified.” Seller eligibility evidence is shown separately
        and never becomes a compliance conclusion.
      </Alert>
      <Card>
        <h2>Screen a research product</h2>
        <div className="form-grid">
          <label>
            Research project
            <ProjectPicker
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              emptyLabel="Choose a project for this assessment"
            />
          </label>
          <label>
            Marketplace
            <MarketplacePicker
              value={marketplaceId}
              onChange={(event) => setMarketplaceId(event.target.value)}
              emptyLabel="Choose a connected marketplace"
            />
          </label>
          <label>
            Jurisdiction
            <TextInput
              value={jurisdiction}
              onChange={(event) =>
                setJurisdiction(event.target.value.toUpperCase())
              }
              placeholder="US"
            />
          </label>
          <label>
            Researched product (optional)
            <ProductPicker
              value={catalogProductId}
              onChange={(event) => setCatalogProductId(event.target.value)}
              emptyLabel="Choose a product saved to this project"
            />
          </label>
        </div>
        <label>
          Additional product evidence / description (optional when product facts
          or a product are present)
          <textarea
            className="rp-input"
            rows={4}
            value={additionalText}
            onChange={(event) => setAdditionalText(event.target.value)}
            placeholder="Describe the intended product; keep only sourced or user-supplied facts."
          />
        </label>
        <div className="inline-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={load}
            disabled={!marketplaceId || !jurisdiction}
          >
            Load configured rules
          </Button>
          <SelectControl
            value={ruleSetId}
            onChange={(event) => setRuleSetId(event.target.value)}
            aria-label="Active compliance ruleset"
          >
            <option value="">Select active rule set</option>
            {workspace?.ruleSets
              .filter((item) => item.status === "ACTIVE")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.version}
                </option>
              ))}
          </SelectControl>
          <Button
            type="button"
            onClick={assess}
            disabled={
              !projectId ||
              !ruleSetId ||
              !jurisdiction ||
              (!catalogProductId && !additionalText.trim())
            }
          >
            Run deterministic screen
          </Button>
        </div>
        {!workspace?.ruleSets.length ? (
          <p>
            No curated rules are configured for this marketplace/jurisdiction.
            The screen will not fabricate coverage.
          </p>
        ) : null}
      </Card>
      {workspace?.ruleSets.map((item) => (
        <Card key={item.id}>
          <h3>
            {item.name}{" "}
            <Badge tone={item.status === "ACTIVE" ? "success" : "neutral"}>
              {item.status}
            </Badge>
          </h3>
          <p>
            Version <strong>{item.version}</strong> · {item.marketplaceId} /{" "}
            {item.jurisdiction} · {item.rules.length} domain rules
          </p>
          <p>
            Source:{" "}
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">
              {item.sourceTitle}
            </a>{" "}
            (published {date(item.sourcePublishedAt)}; accessed{" "}
            {date(item.sourceAccessedAt)})
          </p>
        </Card>
      ))}
      {resultToShow ? <AssessmentReport assessment={assessment!} /> : null}
      <Card>
        <h2>Admin: add a versioned curated ruleset</h2>
        <p>
          Creating a version archives the current active ruleset for this
          marketplace/jurisdiction; earlier assessments retain their original
          rule version. Enter only sources you have reviewed.
        </p>
        <div className="form-grid">
          <label>
            Ruleset name
            <TextInput
              value={ruleSetName}
              onChange={(event) => setRuleSetName(event.target.value)}
            />
          </label>
          <label>
            Version
            <TextInput
              value={ruleSetVersion}
              onChange={(event) => setRuleSetVersion(event.target.value)}
              placeholder="e.g. 2026.08.17"
            />
          </label>
          <label>
            Ruleset source title
            <TextInput
              value={sourceTitle}
              onChange={(event) => setSourceTitle(event.target.value)}
            />
          </label>
          <label>
            Ruleset source URL
            <TextInput
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
        </div>
        <label>
          Rules JSON (one rule per domain; LOW requires authoritativeClearance:
          true)
          <textarea
            className="rp-input"
            rows={16}
            value={rulesJson}
            onChange={(event) => setRulesJson(event.target.value)}
          />
        </label>
        <Button
          type="button"
          onClick={createRuleSet}
          disabled={
            !marketplaceId ||
            !jurisdiction ||
            !ruleSetVersion ||
            !sourceTitle ||
            !sourceUrl
          }
        >
          Save new ruleset version
        </Button>
      </Card>
      {workspace?.assessments.length ? (
        <Card>
          <h2>Prior assessments</h2>
          <ul>
            {workspace.assessments.map((item) => (
              <li key={item.id}>
                {date(item.calculatedAt)} ·{" "}
                {item.catalogProduct?.title ?? "Manual research input"} ·{" "}
                {item.ruleSet.name} {item.ruleSet.version}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}

function AssessmentReport({ assessment }: { assessment: Assessment }) {
  return (
    <section aria-label="Compliance screening results">
      <h2>Screening results</h2>
      <p>
        Ruleset: {assessment.ruleSet.name} {assessment.ruleSet.version} ·
        calculated {date(assessment.calculatedAt)}
      </p>
      {assessment.results.map((result) => (
        <Card key={result.domain}>
          <h3>
            {result.domain.replaceAll("_", " ")}{" "}
            <Badge tone={badgeTone(result.riskLevel)}>{result.riskLevel}</Badge>
          </h3>
          <p>{result.why}</p>
          <p>
            <strong>
              {result.doNotLaunchUntilVerified
                ? "Do not launch until verified"
                : "Authoritative clearance rule matched"}
            </strong>
          </p>
          <h4>Evidence / source</h4>
          <ul>
            {result.evidence.map((item, index) => (
              <li key={`${item.reference}-${index}`}>
                {item.sourceUrl ? (
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                    {item.sourceTitle ?? item.reference}
                  </a>
                ) : (
                  (item.sourceTitle ?? item.reference)
                )}
                {item.sourcePublishedAt
                  ? ` · published ${date(item.sourcePublishedAt)}`
                  : ""}
                {item.observedAt ? ` · observed ${date(item.observedAt)}` : ""}
                <br />
                <small>{item.reference}</small>
              </li>
            ))}
          </ul>
          <h4>Ask supplier</h4>
          <ul>
            {result.questionsToAskSupplier.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>Documentation likely to verify</h4>
          <ul>
            {result.likelyDocumentation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}
