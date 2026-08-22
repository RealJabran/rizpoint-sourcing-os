"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  SelectControl,
  TextInput,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Project = {
  id: string;
  name: string;
  marketplaceId: string;
  status: string;
  version: number;
  updatedAt: string;
  projectTags: Array<{ tag: { id: string; label: string } }>;
  items: Array<{
    id: string;
    kind: string;
    displayLabel: string | null;
    catalogProductId: string | null;
    marketDefinitionId: string | null;
    catalogProduct: {
      id: string;
      title: string;
      asin: string | null;
      brand: string | null;
      productResearchItems: Array<{
        observedAt: string;
        freshnessState: string;
        completeness: string;
        source: string;
        run: {
          id: string;
          status: string;
          completedAt: string | null;
          createdAt: string;
        };
      }>;
    } | null;
    marketDefinition: { id: string; name: string } | null;
    keyword: { phrase: string } | null;
  }>;
  notes: Array<{ id: string; body: string; updatedAt: string }>;
  evidenceReferences: Array<{
    id: string;
    label: string;
    evidenceType: string;
    sourceReference: string;
    observedAt: string | null;
  }>;
  assumptions: Array<{
    id: string;
    label: string;
    value: string;
    assumedAt: string;
  }>;
  decisionMemos: Array<{
    id: string;
    title: string;
    thesis: string;
    outcome: string;
    decisionOwner: string;
    decidedAt: string;
    sourceSnapshot: { evidenceIds?: string[]; assessmentIds?: string[] };
    sources: Array<{ id: string; sourceType: string; sourceId: string }>;
  }>;
  productFacts: unknown[];
  listingDrafts: unknown[];
  launchPlans: unknown[];
  privateLabelQuoteScenarios: unknown[];
  productWatches: unknown[];
  marketDefinitions: unknown[];
  assessments: unknown[];
  complianceRiskAssessments: unknown[];
  portfolioOptimizationRuns: unknown[];
};
type Comparison = {
  candidates: Array<{
    id: string;
    label: string;
    asin?: string | null;
    brand?: string | null;
    opportunityScore: string | null;
    unitsLow?: string | null;
    unitsHigh?: string | null;
    confidencePercent: string | null;
    complianceRisk?: string | null;
  }>;
  comparisons: Array<{ leftId: string; rightId: string; reasons: string[] }>;
};

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "REQUEST_FAILED");
  return payload;
}
function itemLabel(item: Project["items"][number]) {
  return (
    item.displayLabel ??
    item.catalogProduct?.title ??
    item.marketDefinition?.name ??
    item.keyword?.phrase ??
    item.kind
  );
}
function countCard(label: string, value: number) {
  return (
    <Card key={label}>
      <p className="eyebrow">{label}</p>
      <strong className="metric-value">{value}</strong>
    </Card>
  );
}

export function ProjectHubWorkspace() {
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      name: string;
      marketplaceId: string;
      status: string;
    }>
  >([]);
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectMarketplaceId, setProjectMarketplaceId] = useState("");
  const [projectMarketplaces, setProjectMarketplaces] = useState<
    Array<{ id: string; label: string; isDefault: boolean }>
  >([]);
  const load = async (targetId = projectId) => {
    if (!targetId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setProject(
        await request(
          `/api/project-hub?projectId=${encodeURIComponent(targetId)}`,
        ),
      );
      setProjectId(targetId);
      window.history.replaceState(
        null,
        "",
        `/research-projects?projectId=${encodeURIComponent(targetId)}`,
      );
      setComparison(null);
      setSelectedProducts([]);
      setSelectedNiches([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PROJECT_LOAD_FAILED");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void request("/api/research-projects")
      .then((items) => {
        if (cancelled) return;
        setProjects(items);
        const linkedId = new URLSearchParams(window.location.search).get(
          "projectId",
        );
        if (linkedId) void load(linkedId);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "PROJECT_LIST_FAILED",
          );
      });
    return () => {
      cancelled = true;
    };
    // Loading a deep-linked project once on mount is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let cancelled = false;
    void request("/api/marketplaces")
      .then((payload) => {
        if (cancelled) return;
        const items = payload.marketplaces as Array<{
          id: string;
          label: string;
          isDefault: boolean;
        }>;
        setProjectMarketplaces(items);
        setProjectMarketplaceId(
          items.find((item) => item.isDefault)?.id ?? items[0]?.id ?? "",
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>, action: string) => {
    event.preventDefault();
    if (!project) return;
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { action, projectId: project.id };
    form.forEach((value, key) => {
      if (key === "evidenceReferenceIds") return;
      payload[key] = value;
    });
    if (action === "memo") {
      payload.sections = {
        evidence: String(form.get("evidence") ?? ""),
        economics: String(form.get("economics") ?? ""),
        demand: String(form.get("demand") ?? ""),
        competition: String(form.get("competition") ?? ""),
        risks: String(form.get("risks") ?? ""),
        unresolvedQuestions: String(form.get("unresolvedQuestions") ?? ""),
      };
      payload.evidenceReferenceIds = form
        .getAll("evidenceReferenceIds")
        .map(String);
    }
    try {
      setBusy(true);
      await request("/api/project-hub", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      await load();
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PROJECT_SAVE_FAILED");
    } finally {
      setBusy(false);
    }
  };
  const toggle = (
    id: string,
    set: (items: string[]) => void,
    values: string[],
  ) =>
    set(
      values.includes(id)
        ? values.filter((item) => item !== id)
        : values.length < 10
          ? [...values, id]
          : values,
    );
  const compare = async (kind: "products" | "niches", ids: string[]) => {
    if (!project || !ids.length) return;
    try {
      setBusy(true);
      setComparison(
        await request(
          `/api/project-hub?projectId=${encodeURIComponent(project.id)}&compare=${kind}&ids=${ids.map(encodeURIComponent).join(",")}`,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "COMPARISON_FAILED");
    } finally {
      setBusy(false);
    }
  };
  const createProject = async () => {
    if (!newProjectName.trim() || !projectMarketplaceId) return;
    try {
      setBusy(true);
      const created = await request("/api/research-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newProjectName,
          marketplaceId: projectMarketplaceId,
          mode: "PRIVATE_LABEL",
        }),
      });
      setProjects((current) => [created, ...current]);
      setNewProjectName("");
      await load(created.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "PROJECT_CREATE_FAILED",
      );
    } finally {
      setBusy(false);
    }
  };
  const latestResearch = project?.items
    .flatMap((item) => item.catalogProduct?.productResearchItems ?? [])
    .sort(
      (left, right) =>
        new Date(right.observedAt).getTime() -
        new Date(left.observedAt).getTime(),
    )[0];
  return (
    <div className="page-stack">
      <PageHeader
        title="Research Projects"
        description="Evidence-backed project boards, deterministic comparisons, and immutable decision snapshots."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Research Projects" },
        ]}
      />
      <Card>
        <div className="form-grid">
          <SelectControl
            aria-label="Research project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose a research project</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.marketplaceId} · {item.status}
              </option>
            ))}
          </SelectControl>
          <Button
            type="button"
            onClick={() => void load()}
            disabled={busy || !projectId.trim()}
          >
            {busy ? "Loading…" : "Open project"}
          </Button>
          <span className="inline-control">
            <TextInput
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="New project name"
              aria-label="New project name"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void createProject()}
              disabled={busy || !newProjectName.trim() || !projectMarketplaceId}
            >
              Create project
            </Button>
          </span>
          <SelectControl
            aria-label="New project marketplace"
            value={projectMarketplaceId}
            onChange={(event) => setProjectMarketplaceId(event.target.value)}
          >
            {projectMarketplaces.map((marketplace) => (
              <option key={marketplace.id} value={marketplace.id}>
                {marketplace.label}
                {marketplace.isDefault ? " · default" : ""}
              </option>
            ))}
          </SelectControl>
        </div>
      </Card>
      {error ? (
        <Alert tone="danger" title="Project workspace error">
          {error}
        </Alert>
      ) : null}
      {!project ? (
        <Card>
          <h2>Open a project board</h2>
          <p>
            Projects keep candidates, evidence, assumptions, linked research
            outputs, and historical decisions together. Choose a tenant-scoped
            project above or follow a project link from Product Explorer or
            Product Tracker.
          </p>
          {!projects.length && !busy ? (
            <p>
              No projects exist in this organization yet. Create one above, then
              add products without copying an internal ID.
            </p>
          ) : null}
        </Card>
      ) : (
        <>
          <Card>
            <div className="split-row">
              <div>
                <h2>{project.name}</h2>
                <p>
                  {project.marketplaceId} · version {project.version}
                </p>
              </div>
              <Badge tone="neutral">{project.status}</Badge>
            </div>
            <p>
              {project.projectTags.map((item) => item.tag.label).join(", ") ||
                "No tags"}
            </p>
            <div className="research-evidence-strip">
              <span>
                Last research run:{" "}
                {latestResearch
                  ? new Date(
                      latestResearch.run.completedAt ??
                        latestResearch.run.createdAt,
                    ).toLocaleString()
                  : "No product research yet"}
              </span>
              <span>
                Freshness:{" "}
                {latestResearch?.freshnessState.toLowerCase() ?? "unknown"}
              </span>
              <span>
                Evidence:{" "}
                {latestResearch?.completeness.toLowerCase() ?? "not available"}
              </span>
              <span>
                Project activity: {new Date(project.updatedAt).toLocaleString()}
              </span>
              <ButtonLink href="/product-research" size="sm" variant="quiet">
                Research products
              </ButtonLink>
            </div>
          </Card>
          <div className="metric-grid">
            {[
              ["Candidates", project.items.length],
              ["Evidence", project.evidenceReferences.length],
              ["Assumptions", project.assumptions.length],
              ["Memos", project.decisionMemos.length],
              ["Watches", project.productWatches.length],
              ["Launch plans", project.launchPlans.length],
            ].map(([label, value]) => countCard(String(label), Number(value)))}
          </div>
          <div className="two-column">
            <Card>
              <h2>Candidate products</h2>
              {project.items.filter((item) => item.kind === "PRODUCT")
                .length ? (
                project.items
                  .filter((item) => item.kind === "PRODUCT")
                  .map((item) => (
                    <label key={item.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(
                          item.catalogProductId ?? "",
                        )}
                        onChange={() =>
                          item.catalogProductId &&
                          toggle(
                            item.catalogProductId,
                            setSelectedProducts,
                            selectedProducts,
                          )
                        }
                      />{" "}
                      <span>
                        {itemLabel(item)}{" "}
                        <small>
                          {item.catalogProduct?.asin ?? "No ASIN"} ·{" "}
                          {item.catalogProduct?.brand ?? "Brand unavailable"}
                        </small>
                        {item.catalogProduct?.productResearchItems[0] ? (
                          <small>
                            {item.catalogProduct.productResearchItems[0].source}{" "}
                            ·{" "}
                            {item.catalogProduct.productResearchItems[0].freshnessState.toLowerCase()}{" "}
                            · observed{" "}
                            {new Date(
                              item.catalogProduct.productResearchItems[0]
                                .observedAt,
                            ).toLocaleString()}
                          </small>
                        ) : (
                          <small>No manual research evidence stored yet.</small>
                        )}
                      </span>
                    </label>
                  ))
              ) : (
                <p>No product candidates saved yet.</p>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={!selectedProducts.length || busy}
                onClick={() => compare("products", selectedProducts)}
              >
                Compare selected (max 10)
              </Button>
            </Card>
            <Card>
              <h2>Candidate niches</h2>
              {project.items.filter((item) => item.kind === "MARKET").length ? (
                project.items
                  .filter((item) => item.kind === "MARKET")
                  .map((item) => (
                    <label key={item.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={selectedNiches.includes(
                          item.marketDefinitionId ?? "",
                        )}
                        onChange={() =>
                          item.marketDefinitionId &&
                          toggle(
                            item.marketDefinitionId,
                            setSelectedNiches,
                            selectedNiches,
                          )
                        }
                      />{" "}
                      <span>{itemLabel(item)}</span>
                    </label>
                  ))
              ) : (
                <p>No niche/market candidates saved yet.</p>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={!selectedNiches.length || busy}
                onClick={() => compare("niches", selectedNiches)}
              >
                Compare selected (max 10)
              </Button>
            </Card>
          </div>
          {comparison ? (
            <Card>
              <h2>Normalized comparison</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Opportunity</th>
                      <th>Demand range</th>
                      <th>Confidence</th>
                      <th>Compliance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.candidates.map((item) => (
                      <tr key={item.id}>
                        <td>{item.label}</td>
                        <td>{item.opportunityScore ?? "Unavailable"}</td>
                        <td>
                          {item.unitsLow && item.unitsHigh
                            ? `${item.unitsLow}–${item.unitsHigh}`
                            : "Unavailable"}
                        </td>
                        <td>{item.confidencePercent ?? "Unavailable"}</td>
                        <td>{item.complianceRisk ?? "Unavailable"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Why one candidate is stronger</h3>
              {comparison.comparisons.map((pair) => (
                <p key={`${pair.leftId}-${pair.rightId}`}>
                  {pair.reasons.join(" ")}
                </p>
              ))}
            </Card>
          ) : null}
          <div className="two-column">
            <Card>
              <h2>Economics</h2>
              <p>
                {project.privateLabelQuoteScenarios.length} supplier quote
                scenario(s) are linked to this project.
              </p>
              <p>
                Product fees remain evidence inputs. Profit is shown only by a
                deterministic wholesale or private-label calculation, never an
                AI estimate.
              </p>
              <ButtonLink
                href="/private-label-profitability"
                variant="secondary"
              >
                Open profitability
              </ButtonLink>
            </Card>
            <Card>
              <h2>Risks</h2>
              <p>
                {project.complianceRiskAssessments.length} compliance check(s)
                are linked. Unknown risks remain unknown until evidence is
                verified.
              </p>
              <ButtonLink href="/compliance-risk" variant="secondary">
                Review compliance risks
              </ButtonLink>
            </Card>
          </div>
          <div className="two-column">
            <Card>
              <h2>Notes</h2>
              <form
                className="page-stack"
                onSubmit={(event) => submit(event, "note")}
              >
                <textarea
                  className="rp-input"
                  name="body"
                  aria-label="Project note"
                  placeholder="Record a research note"
                  required
                />
                <Button disabled={busy}>Add note</Button>
              </form>
              {project.notes.length ? (
                <ul>
                  {project.notes.map((note) => (
                    <li key={note.id}>
                      {note.body}{" "}
                      <small>
                        · {new Date(note.updatedAt).toLocaleString()}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No notes recorded yet.</p>
              )}
            </Card>
            <Card>
              <h2>Add evidence reference</h2>
              <form
                className="page-stack"
                onSubmit={(event) => submit(event, "evidence")}
              >
                <TextInput name="label" aria-label="Label" required />
                <TextInput
                  name="evidenceType"
                  aria-label="Type"
                  placeholder="provider observation, attachment reference"
                  required
                />
                <TextInput
                  name="sourceReference"
                  aria-label="Authorized source/reference"
                  required
                />
                <TextInput
                  name="sourceDescription"
                  aria-label="Description (optional)"
                />
                <Button disabled={busy}>Save evidence</Button>
              </form>
              <ul>
                {project.evidenceReferences.map((item) => (
                  <li key={item.id}>
                    <strong>{item.label}</strong> — {item.evidenceType}:{" "}
                    {item.sourceReference}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2>Record assumption</h2>
              <form
                className="page-stack"
                onSubmit={(event) => submit(event, "assumption")}
              >
                <TextInput name="label" aria-label="Assumption" required />
                <TextInput name="value" aria-label="Value" required />
                <TextInput
                  name="sourceReference"
                  aria-label="Source reference (optional)"
                />
                <Button disabled={busy}>Save assumption</Button>
              </form>
              <ul>
                {project.assumptions.map((item) => (
                  <li key={item.id}>
                    <strong>{item.label}:</strong> {item.value}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card>
            <h2>Decision memo</h2>
            <p>
              A memo stores its source IDs and compact snapshot at creation. It
              is not overwritten when live research changes.
            </p>
            <form
              className="page-stack"
              onSubmit={(event) => submit(event, "memo")}
            >
              <div className="form-grid">
                <TextInput name="title" aria-label="Title" required />
                <TextInput
                  name="decisionOwner"
                  aria-label="Decision owner"
                  required
                />
                <label>
                  Decision
                  <select
                    className="rp-input"
                    name="outcome"
                    defaultValue="HOLD"
                  >
                    <option>GO</option>
                    <option>NO_GO</option>
                    <option>HOLD</option>
                  </select>
                </label>
              </div>
              <TextInput name="thesis" aria-label="Thesis" required />
              <textarea
                className="rp-input"
                name="evidence"
                placeholder="Evidence"
              />
              <textarea
                className="rp-input"
                name="economics"
                placeholder="Economics"
              />
              <textarea
                className="rp-input"
                name="demand"
                placeholder="Demand"
              />
              <textarea
                className="rp-input"
                name="competition"
                placeholder="Competition"
              />
              <textarea className="rp-input" name="risks" placeholder="Risks" />
              <textarea
                className="rp-input"
                name="unresolvedQuestions"
                placeholder="Unresolved questions"
              />
              <fieldset>
                <legend>Evidence included in snapshot</legend>
                {project.evidenceReferences.map((item) => (
                  <label className="check-row" key={item.id}>
                    <input
                      type="checkbox"
                      name="evidenceReferenceIds"
                      value={item.id}
                    />{" "}
                    {item.label}
                  </label>
                ))}
              </fieldset>
              <Button disabled={busy}>Create immutable memo</Button>
            </form>
            {project.decisionMemos.map((memo) => (
              <article key={memo.id} className="inset-card">
                <div className="split-row">
                  <strong>{memo.title}</strong>
                  <Badge tone="neutral">{memo.outcome}</Badge>
                </div>
                <p>{memo.thesis}</p>
                <small>
                  {memo.decisionOwner} ·{" "}
                  {new Date(memo.decidedAt).toLocaleString()} ·{" "}
                  {memo.sources.length} stored source IDs
                </small>
              </article>
            ))}
          </Card>
          <Card>
            <h2>Linked research outputs</h2>
            <p>
              {project.productFacts.length} facts ·{" "}
              {project.listingDrafts.length} listing drafts ·{" "}
              {project.privateLabelQuoteScenarios.length} supplier quote
              scenarios · {project.complianceRiskAssessments.length} compliance
              checks · {project.assessments.length} opportunity assessments ·{" "}
              {project.portfolioOptimizationRuns.length} portfolio runs ·{" "}
              {project.notes.length} notes.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
