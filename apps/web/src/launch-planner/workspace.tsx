"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  SelectControl,
  TextInput,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { ProjectPicker } from "@/src/components/entity-pickers";

type Stage = {
  id: string;
  stage: string;
  status: string;
  dependencies: string[];
  ownerLabel: string | null;
  dueDate: string | null;
  budget: { toString(): string } | null;
  budgetCurrency: string | null;
  targetKpis: string[];
  assumptions: string[];
  risks: string[];
  evidenceRefs: string[];
};
type Plan = {
  id: string;
  evidenceSnapshot: { validation: string };
  researchOutputs: {
    targetKeywords: Array<{ phrase: string }>;
    competitorSet: Array<{ asin: string | null; title: string }>;
    unavailable: string[];
  };
  stages: Stage[];
  changes: Array<{
    id: string;
    action: string;
    stage: string | null;
    createdAt: string;
  }>;
};
const stageNames = [
  "NICHE_APPROVED",
  "SUPPLIER_SAMPLE",
  "COMPLIANCE_VALIDATION",
  "FINAL_COST",
  "BRAND_TRADEMARK_READINESS",
  "PACKAGING_ARTWORK",
  "LISTING_ASSETS",
  "KEYWORD_PLAN",
  "INVENTORY_ORDER",
  "SHIPMENT_FBA",
  "LAUNCH_DATE",
  "ADVERTISING_SETUP",
  "RANK_MARKET_MONITORING",
  "REVIEW_RETURNS_LEARNING",
];
const list = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

export function LaunchPlanner() {
  const [projectId, setProjectId] = useState("");
  const [planId, setPlanId] = useState("");
  const [plans, setPlans] = useState<Array<{ id: string; name: string }>>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stage, setStage] = useState(stageNames[0]!);
  const [status, setStatus] = useState("NOT_STARTED");
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [budget, setBudget] = useState("");
  const [kpis, setKpis] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [risks, setRisks] = useState("");
  const [evidence, setEvidence] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetch(`/api/project-hub?projectId=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setPlans(payload?.launchPlans ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId]);
  async function load(id = planId) {
    const response = await fetch(
      `/api/launch-planner?planId=${encodeURIComponent(id)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error);
      return;
    }
    setPlan(body);
    setPlanId(body.id);
    setMessage(null);
  }
  async function create() {
    const response = await fetch("/api/launch-planner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "CREATE",
        projectId,
        name: "",
        assumptions: list(assumptions),
        risks: list(risks),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error);
      return;
    }
    setPlanId(body.id);
    await load(body.id);
  }
  async function updateStage() {
    const response = await fetch("/api/launch-planner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "UPDATE_STAGE",
        planId,
        stage,
        status,
        ownerLabel: owner,
        dueDate,
        budget,
        budgetCurrency: "USD",
        targetKpis: list(kpis),
        assumptions: list(assumptions),
        risks: list(risks),
        evidenceRefs: list(evidence),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error);
      return;
    }
    await load();
  }
  return (
    <main className="content-page">
      <PageHeader
        title="Private-Label Launch Planner"
        description="A research-linked, dependency-enforced execution plan; it never creates purchases or Seller Central writes."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Launch planner" },
        ]}
      />
      <Alert tone="info" title="Exact research snapshot">
        A plan snapshots the project, assessment version/input references,
        research items, notes, competitors, keywords, and watches at creation.
        Later project changes do not rewrite launch approval evidence.
      </Alert>
      <Card>
        <label htmlFor="launch-project">Validated research project</label>
        <div className="inline-actions">
          <ProjectPicker
            id="launch-project"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setPlans([]);
              setPlanId("");
              setPlan(null);
            }}
          />
          <Button type="button" onClick={create} disabled={!projectId}>
            Create stage-gated plan
          </Button>
        </div>
        <label htmlFor="launch-plan">Existing launch plan</label>
        <div className="inline-actions">
          <SelectControl
            id="launch-plan"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
          >
            <option value="">Choose a plan from this project</option>
            {plans.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || "Stage-gated launch plan"}
              </option>
            ))}
          </SelectControl>
          <Button
            type="button"
            variant="secondary"
            onClick={() => load()}
            disabled={!planId}
          >
            Load plan
          </Button>
        </div>
        <label htmlFor="launch-assumptions">
          Launch assumptions (one per line)
        </label>
        <textarea
          id="launch-assumptions"
          className="rp-input"
          value={assumptions}
          onChange={(event) => setAssumptions(event.target.value)}
        />
        <label htmlFor="launch-risks">Known risks (one per line)</label>
        <textarea
          id="launch-risks"
          className="rp-input"
          value={risks}
          onChange={(event) => setRisks(event.target.value)}
        />
        {message ? <p role="alert">{message}</p> : null}
      </Card>
      {plan ? (
        <>
          <Card>
            <h2>Research-derived outputs</h2>
            <p>Validation: {plan.evidenceSnapshot.validation}</p>
            <p>
              Target keywords:{" "}
              {plan.researchOutputs.targetKeywords
                .map((item) => item.phrase)
                .join(", ") || "Unavailable"}
            </p>
            <p>
              Competitor set:{" "}
              {plan.researchOutputs.competitorSet
                .map((item) => item.asin ?? item.title)
                .join(", ") || "Unavailable"}
            </p>
            <p>Unavailable: {plan.researchOutputs.unavailable.join("; ")}</p>
          </Card>
          <Card>
            <h2>Stage gate</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Dependencies</th>
                    <th>Owner</th>
                    <th>Due</th>
                    <th>Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.stages.map((item) => (
                    <tr key={item.id}>
                      <td>{item.stage}</td>
                      <td>
                        <Badge
                          tone={
                            item.status === "COMPLETE"
                              ? "success"
                              : item.status === "BLOCKED"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {item.status}
                        </Badge>
                      </td>
                      <td>{item.dependencies.join(", ") || "—"}</td>
                      <td>{item.ownerLabel ?? "Unassigned"}</td>
                      <td>
                        {item.dueDate
                          ? new Date(item.dueDate).toLocaleDateString()
                          : "—"}
                      </td>
                      <td>
                        {item.budget?.toString() ?? "—"}{" "}
                        {item.budgetCurrency ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <h2>Update a stage</h2>
            <SelectControl
              value={stage}
              onChange={(event) => setStage(event.target.value)}
            >
              {stageNames.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </SelectControl>
            <SelectControl
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETE"].map(
                (item) => (
                  <option key={item}>{item}</option>
                ),
              )}
            </SelectControl>
            <TextInput
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="Owner"
            />
            <TextInput
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              aria-label="Due date"
            />
            <TextInput
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="Budget (USD Decimal)"
            />
            <textarea
              className="rp-input"
              value={kpis}
              onChange={(event) => setKpis(event.target.value)}
              placeholder="Target KPIs, one per line"
            />
            <textarea
              className="rp-input"
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="Evidence links/IDs, one per line"
            />
            <textarea
              className="rp-input"
              value={assumptions}
              onChange={(event) => setAssumptions(event.target.value)}
              placeholder="Stage assumptions, one per line"
            />
            <textarea
              className="rp-input"
              value={risks}
              onChange={(event) => setRisks(event.target.value)}
              placeholder="Stage risks, one per line"
            />
            <Button type="button" onClick={updateStage}>
              Save stage update
            </Button>
          </Card>
          <Card>
            <h2>Change log</h2>
            <ul>
              {plan.changes.map((change) => (
                <li key={change.id}>
                  {new Date(change.createdAt).toLocaleString()} —{" "}
                  {change.action}
                  {change.stage ? ` (${change.stage})` : ""}
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </main>
  );
}
