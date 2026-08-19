"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  SelectControl,
  TextInput,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Allocation = {
  id: string;
  asin: string;
  brand: string;
  category: string;
  quantity: number;
  casePack: number;
  moq: number;
  unitCost: string;
  cashAllocated: string;
  expectedProfitLow: string;
  expectedProfitHigh: string;
  expectedUnitsSoldLow: string;
  expectedUnitsSoldHigh: string;
  coverageDays: number;
  evidenceReferences: string[];
};
type Result = {
  id: string;
  scenario: string;
  rank: number;
  status: string;
  exactOptimal: boolean;
  searchNodes: number;
  cashUsed: string | null;
  cashRemaining: string | null;
  expectedProfitLow: string | null;
  expectedProfitHigh: string | null;
  productCount: number | null;
  diversificationScore: string | null;
  riskConcentration: Record<string, string>;
  constraintAudit: Array<{
    constraint: string;
    limit: string;
    actual: string;
    passed: boolean;
    details: string;
  }>;
  excludedProducts: Array<{
    candidateId: string;
    asin: string;
    reasons: string[];
  }>;
  assumptions: Record<string, string>;
  reasonCodes: string[];
  allocations: Allocation[];
};
type Run = {
  id: string;
  name: string;
  status: string;
  solverVersion: string;
  currency: string;
  cashBudget: string;
  calculatedAt: string;
  results: Result[];
};
type Data = { project: { name: string; marketplaceId: string }; runs: Run[] };

const candidateTemplate = JSON.stringify(
  [
    {
      id: "candidate-1",
      catalogProductId: "project-owned-catalog-product-id",
      asin: "B000000000",
      brand: "Verified brand",
      category: "Observed category",
      currency: "USD",
      unitCost: "0.00",
      sellingPrice: "0.00",
      feePerUnit: "0.00",
      adCostPerUnit: "0.00",
      moq: 1,
      casePack: 1,
      expectedMonthlyDemandLow: "0",
      expectedMonthlyDemandHigh: "0",
      netProfitPerUnitLow: "0.00",
      netProfitPerUnitHigh: "0.00",
      leadTimeDays: 30,
      marginPercent: "0",
      roiPercent: "0",
      confidencePercent: "0",
      seasonalityRisk: "LOW",
      complianceRisk: "UNKNOWN",
      priceVolatilityPercent: "0",
      competitionRisk: "LOW",
      targetInventoryDays: 30,
      observedAt: "2026-08-17T00:00:00.000Z",
      evidenceReferences: ["source record/version reference"],
    },
  ],
  null,
  2,
);

function tone(status: string) {
  if (status === "CALCULATED") return "success" as const;
  if (status === "PARTIAL_SUCCESS" || status === "NO_FEASIBLE_PORTFOLIO")
    return "warning" as const;
  return "danger" as const;
}
function money(value: string | null, currency: string) {
  return value === null ? "Unavailable" : `${currency} ${value}`;
}

export function PortfolioOptimizerWorkspace() {
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [budget, setBudget] = useState("");
  const [maxAsin, setMaxAsin] = useState("40");
  const [maxBrand, setMaxBrand] = useState("60");
  const [maxCategory, setMaxCategory] = useState("70");
  const [minMargin, setMinMargin] = useState("10");
  const [minRoi, setMinRoi] = useState("20");
  const [minConfidence, setMinConfidence] = useState("50");
  const [maxVolatility, setMaxVolatility] = useState("30");
  const [maxSeasonality, setMaxSeasonality] = useState("MEDIUM");
  const [maxCompetition, setMaxCompetition] = useState("MEDIUM");
  const [allowedCompliance, setAllowedCompliance] = useState("LOW,REVIEW");
  const [demandDown, setDemandDown] = useState("20");
  const [priceDown, setPriceDown] = useState("10");
  const [feeUp, setFeeUp] = useState("5");
  const [delayDays, setDelayDays] = useState("30");
  const [adUp, setAdUp] = useState("20");
  const [candidateJson, setCandidateJson] = useState(candidateTemplate);
  const [data, setData] = useState<Data | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [scenario, setScenario] = useState("BASE");
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function load(preferredRunId?: string) {
    const response = await fetch(
      `/api/portfolio-optimizer?projectId=${encodeURIComponent(projectId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error ?? "PORTFOLIO_OPTIMIZATIONS_UNAVAILABLE");
      return;
    }
    setData(body);
    const run =
      body.runs.find((item: Run) => item.id === preferredRunId) ?? body.runs[0];
    setSelectedRun(run ?? null);
    setMessage(null);
  }
  async function optimize() {
    let candidates: unknown;
    try {
      candidates = JSON.parse(candidateJson);
    } catch {
      setMessage("CANDIDATE_JSON_INVALID");
      return;
    }
    setRunning(true);
    const response = await fetch("/api/portfolio-optimizer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        name,
        candidates,
        constraints: {
          cashBudget: budget,
          currency,
          maxAsinExposurePercent: maxAsin,
          maxBrandExposurePercent: maxBrand,
          maxCategoryExposurePercent: maxCategory,
          minMarginPercent: minMargin,
          minRoiPercent: minRoi,
          minConfidencePercent: minConfidence,
          maxPriceVolatilityPercent: maxVolatility,
          allowedComplianceRisks: allowedCompliance
            .split(",")
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
          maxSeasonalityRisk: maxSeasonality,
          maxCompetitionRisk: maxCompetition,
        },
        stressAssumptions: {
          demandDecreasePercent: demandDown,
          priceDecreasePercent: priceDown,
          feeIncreasePercent: feeUp,
          replenishmentDelayDays: Number(delayDays),
          adCostIncreasePercent: adUp,
        },
      }),
    });
    const body = await response.json();
    setRunning(false);
    if (!response.ok) {
      setMessage(body.error ?? "PORTFOLIO_OPTIMIZATION_FAILED");
      return;
    }
    setMessage(
      body.status === "SOLVER_FAILED"
        ? "The exact solver failed safely; no partial recommendation was published."
        : `Saved ${body.name} with status ${body.status}.`,
    );
    await load(body.id);
  }
  const scenarioResults = useMemo(
    () =>
      selectedRun?.results
        .filter((result) => result.scenario === scenario)
        .sort((left, right) => left.rank - right.rank) ?? [],
    [selectedRun, scenario],
  );

  return (
    <main className="content-page">
      <PageHeader
        title="Portfolio & Cash Allocation"
        description="Exact, deterministic case-pack allocation under auditable cash, exposure, demand, economics, confidence, and risk constraints."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Portfolio optimizer" },
        ]}
      />
      <Alert tone="info" title="Deterministic integer optimization">
        The objective maximizes conservative expected profit, then high-case
        profit, then product count. It uses Decimal arithmetic and integer
        MOQ/case quantities—not an LLM. If bounded branch-and-bound cannot prove
        optimality, the run fails closed without publishing a partial portfolio.
      </Alert>
      <Card>
        <h2>Project and constraint policy</h2>
        <div className="form-grid">
          <label>
            ResearchProject ID
            <TextInput
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            />
          </label>
          <label>
            Run name
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Base sourcing portfolio"
            />
          </label>
          <label>
            Currency
            <TextInput
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value.toUpperCase())
              }
            />
          </label>
          <label>
            Cash budget
            <TextInput
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
          <label>
            Max ASIN exposure %
            <TextInput
              inputMode="decimal"
              value={maxAsin}
              onChange={(event) => setMaxAsin(event.target.value)}
            />
          </label>
          <label>
            Max brand exposure %
            <TextInput
              inputMode="decimal"
              value={maxBrand}
              onChange={(event) => setMaxBrand(event.target.value)}
            />
          </label>
          <label>
            Max category exposure %
            <TextInput
              inputMode="decimal"
              value={maxCategory}
              onChange={(event) => setMaxCategory(event.target.value)}
            />
          </label>
          <label>
            Minimum margin %
            <TextInput
              inputMode="decimal"
              value={minMargin}
              onChange={(event) => setMinMargin(event.target.value)}
            />
          </label>
          <label>
            Minimum ROI %
            <TextInput
              inputMode="decimal"
              value={minRoi}
              onChange={(event) => setMinRoi(event.target.value)}
            />
          </label>
          <label>
            Minimum confidence %
            <TextInput
              inputMode="decimal"
              value={minConfidence}
              onChange={(event) => setMinConfidence(event.target.value)}
            />
          </label>
          <label>
            Maximum price volatility %
            <TextInput
              inputMode="decimal"
              value={maxVolatility}
              onChange={(event) => setMaxVolatility(event.target.value)}
            />
          </label>
          <label>
            Allowed compliance risks
            <TextInput
              value={allowedCompliance}
              onChange={(event) => setAllowedCompliance(event.target.value)}
              aria-describedby="compliance-risk-help"
            />
            <small id="compliance-risk-help">
              Comma separated: LOW, REVIEW, HIGH, UNKNOWN. UNKNOWN is excluded
              by default.
            </small>
          </label>
          <label>
            Maximum seasonality risk
            <SelectControl
              value={maxSeasonality}
              onChange={(event) => setMaxSeasonality(event.target.value)}
            >
              <option>LOW</option>
              <option>MEDIUM</option>
              <option>HIGH</option>
            </SelectControl>
          </label>
          <label>
            Maximum competition risk
            <SelectControl
              value={maxCompetition}
              onChange={(event) => setMaxCompetition(event.target.value)}
            >
              <option>LOW</option>
              <option>MEDIUM</option>
              <option>HIGH</option>
            </SelectControl>
          </label>
        </div>
        <div className="inline-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => load()}
            disabled={!projectId}
          >
            Load prior runs
          </Button>
        </div>
      </Card>
      <Card>
        <h2>Stress assumptions</h2>
        <p>
          These exact values are stored with the run and shown on every scenario
          result.
        </p>
        <div className="form-grid">
          <label>
            Demand decrease %
            <TextInput
              value={demandDown}
              onChange={(event) => setDemandDown(event.target.value)}
            />
          </label>
          <label>
            Price decrease %
            <TextInput
              value={priceDown}
              onChange={(event) => setPriceDown(event.target.value)}
            />
          </label>
          <label>
            Fee increase %
            <TextInput
              value={feeUp}
              onChange={(event) => setFeeUp(event.target.value)}
            />
          </label>
          <label>
            Replenishment delay days
            <TextInput
              inputMode="numeric"
              value={delayDays}
              onChange={(event) => setDelayDays(event.target.value)}
            />
          </label>
          <label>
            Ad cost increase %
            <TextInput
              value={adUp}
              onChange={(event) => setAdUp(event.target.value)}
            />
          </label>
        </div>
      </Card>
      <Card>
        <h2>Candidate evidence inputs</h2>
        <p>
          Every candidate must reference a CatalogProduct saved in this project
          and include dated evidence references. Monetary values are decimal
          strings. The template is input guidance only; it is not market data.
        </p>
        <textarea
          className="rp-input"
          rows={28}
          value={candidateJson}
          onChange={(event) => setCandidateJson(event.target.value)}
          aria-label="Portfolio candidate JSON"
        />
        <Button
          type="button"
          onClick={optimize}
          loading={running}
          disabled={!projectId || !name || !budget}
        >
          Optimize and save
        </Button>
      </Card>
      {data?.runs.length ? (
        <Card>
          <h2>Saved runs</h2>
          <SelectControl
            value={selectedRun?.id ?? ""}
            onChange={(event) =>
              setSelectedRun(
                data.runs.find((run) => run.id === event.target.value) ?? null,
              )
            }
            aria-label="Saved portfolio run"
          >
            {data.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name} · {run.status} ·{" "}
                {new Date(run.calculatedAt).toLocaleDateString()}
              </option>
            ))}
          </SelectControl>
        </Card>
      ) : data ? (
        <Alert tone="info" title="No portfolio runs">
          Add sourced project candidates and run the optimizer. No allocation is
          inferred from missing data.
        </Alert>
      ) : null}
      {selectedRun ? (
        <section aria-label="Portfolio optimization output">
          <Card>
            <h2>
              {selectedRun.name}{" "}
              <Badge tone={tone(selectedRun.status)}>
                {selectedRun.status}
              </Badge>
            </h2>
            <p>
              {selectedRun.solverVersion} · budget{" "}
              {money(selectedRun.cashBudget, selectedRun.currency)}
            </p>
            <SelectControl
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              aria-label="Stress scenario"
            >
              <option value="BASE">Base</option>
              <option value="DEMAND_DOWN_20">Demand decrease</option>
              <option value="PRICE_DOWN_10">Price decrease</option>
              <option value="FEE_UP_5">Fee increase</option>
              <option value="DELAYED_REPLENISHMENT">
                Delayed replenishment
              </option>
              <option value="AD_COST_INCREASE">Ad cost increase</option>
            </SelectControl>
          </Card>
          {scenarioResults.map((result) => (
            <PortfolioResult
              key={result.id}
              result={result}
              currency={selectedRun.currency}
            />
          ))}
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}

function PortfolioResult({
  result,
  currency,
}: {
  result: Result;
  currency: string;
}) {
  return (
    <Card>
      <h3>
        {result.rank === 0
          ? "Recommended allocation"
          : `Alternative ${result.rank}`}{" "}
        <Badge tone={tone(result.status)}>{result.status}</Badge>
      </h3>
      <p>
        {result.exactOptimal ? "Exact optimum proven" : "No optimality claim"} ·{" "}
        {result.searchNodes.toLocaleString()} search nodes
      </p>
      <p>
        <strong>Cash used:</strong> {money(result.cashUsed, currency)} ·{" "}
        <strong>remaining:</strong> {money(result.cashRemaining, currency)} ·{" "}
        <strong>profit range:</strong>{" "}
        {money(result.expectedProfitLow, currency)}–
        {money(result.expectedProfitHigh, currency)} ·{" "}
        <strong>diversification:</strong>{" "}
        {result.diversificationScore ?? "Unavailable"}%
      </p>
      <p>
        <strong>Scenario assumptions:</strong>{" "}
        {Object.entries(result.assumptions)
          .map(([key, value]) => `${key}=${value}`)
          .join(" · ")}
      </p>
      {result.reasonCodes.length ? (
        <Alert tone="danger" title="No recommendation published">
          {result.reasonCodes.join(" · ")}
        </Alert>
      ) : null}
      {result.allocations.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ASIN</th>
                <th>Brand / category</th>
                <th>Quantity</th>
                <th>Cash</th>
                <th>Profit range</th>
                <th>Demand units</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {result.allocations.map((allocation) => (
                <tr key={allocation.id}>
                  <td>{allocation.asin}</td>
                  <td>
                    {allocation.brand}
                    <br />
                    <small>{allocation.category}</small>
                  </td>
                  <td>
                    {allocation.quantity}
                    <br />
                    <small>
                      MOQ {allocation.moq}; case {allocation.casePack}
                    </small>
                  </td>
                  <td>{money(allocation.cashAllocated, currency)}</td>
                  <td>
                    {money(allocation.expectedProfitLow, currency)}–
                    {money(allocation.expectedProfitHigh, currency)}
                  </td>
                  <td>
                    {allocation.expectedUnitsSoldLow}–
                    {allocation.expectedUnitsSoldHigh}
                    <br />
                    <small>{allocation.coverageDays} coverage days</small>
                  </td>
                  <td>{allocation.evidenceReferences.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No allocation is available for this scenario.</p>
      )}
      {Object.keys(result.riskConcentration).length ? (
        <p>
          <strong>Risk concentration:</strong>{" "}
          {Object.entries(result.riskConcentration)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")}
        </p>
      ) : null}
      {result.constraintAudit.length ? (
        <>
          <h4>Constraint audit</h4>
          <ul>
            {result.constraintAudit.map((audit) => (
              <li key={audit.constraint}>
                <Badge tone={audit.passed ? "success" : "danger"}>
                  {audit.passed ? "PASS" : "FAIL"}
                </Badge>{" "}
                {audit.constraint}: actual {audit.actual}; limit {audit.limit}.{" "}
                {audit.details}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {result.excludedProducts.length ? (
        <>
          <h4>Excluded products</h4>
          <ul>
            {result.excludedProducts.map((item) => (
              <li key={item.candidateId}>
                {item.asin}: {item.reasons.join(" · ")}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
