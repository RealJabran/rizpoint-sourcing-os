"use client";

import { useState } from "react";
import {
  PRIVATE_LABEL_COST_CATEGORIES,
  type PrivateLabelCostCategory,
} from "@rizpoint/profit-engine";
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

type CostDraft = {
  allocation: "PER_UNIT" | "BATCH_TOTAL" | "PERCENT_OF_PRICE";
  amount: string;
  currency: string;
  source: string;
  assumedAt: string;
  confidence: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
};
type Result = {
  id: string;
  kind: "BASE" | "STRESS";
  stressName: string;
  status: string;
  currency: string;
  landedCostPerUnit: string | null;
  contributionMarginPerUnit: string | null;
  netProfitPerUnit: string | null;
  roiPercent: string | null;
  marginPercent: string | null;
  breakEvenSalePrice: string | null;
  breakEvenAdSpendPerUnit: string | null;
  breakEvenAcosPercent: string | null;
  initialCashRequired: string | null;
  moqCashExposure: string | null;
  waterfall: Array<{
    category: string;
    perUnit: string;
    confidence: string;
  }>;
  uncertainCosts: string[];
  reasonCodes: string[];
};
type Scenario = {
  id: string;
  name: string;
  version: number;
  incoterm: string;
  supplierCurrency: string;
  analysisCurrency: string;
  unitCost: string;
  moq: number;
  targetSellingPrice: string;
  formulaVersion: string;
  results: Result[];
};
type Data = { scenarios: Scenario[] };

const batchCategories = new Set<PrivateLabelCostCategory>([
  "SAMPLES",
  "TOOLING_SETUP",
  "INSPECTION",
  "FREIGHT",
  "CUSTOMS_TARIFFS",
  "INSURANCE",
  "AD_LAUNCH_BUDGET",
]);
const percentageCategories = new Set<PrivateLabelCostCategory>([
  "AMAZON_REFERRAL",
  "RETURNS_ALLOWANCE",
  "COUPON_PROMO",
]);
function initialCosts(): Record<PrivateLabelCostCategory, CostDraft> {
  return Object.fromEntries(
    PRIVATE_LABEL_COST_CATEGORIES.map((category) => [
      category,
      {
        allocation: percentageCategories.has(category)
          ? "PERCENT_OF_PRICE"
          : batchCategories.has(category)
            ? "BATCH_TOTAL"
            : "PER_UNIT",
        amount: "",
        currency: "USD",
        source: "",
        assumedAt: "",
        confidence: "UNKNOWN",
      },
    ]),
  ) as Record<PrivateLabelCostCategory, CostDraft>;
}
const value = (input: string | null) => input ?? "Unavailable";

export function PrivateLabelProfitability() {
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [incoterm, setIncoterm] = useState<"EXW" | "FOB" | "DDP">("FOB");
  const [supplierCurrency, setSupplierCurrency] = useState("USD");
  const [analysisCurrency, setAnalysisCurrency] = useState("USD");
  const [unitCost, setUnitCost] = useState("");
  const [unitCostSource, setUnitCostSource] = useState("");
  const [unitCostAssumedAt, setUnitCostAssumedAt] = useState("");
  const [moq, setMoq] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetPriceSource, setTargetPriceSource] = useState("");
  const [targetPriceAssumedAt, setTargetPriceAssumedAt] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [fxSource, setFxSource] = useState("");
  const [fxObservedAt, setFxObservedAt] = useState("");
  const [costs, setCosts] = useState(initialCosts);
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateCost(
    category: PrivateLabelCostCategory,
    patch: Partial<CostDraft>,
  ) {
    setCosts((current) => ({
      ...current,
      [category]: { ...current[category], ...patch },
    }));
  }
  async function load() {
    const response = await fetch(
      `/api/private-label-profitability?projectId=${encodeURIComponent(projectId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error);
      return;
    }
    setData(body);
    setMessage(null);
  }
  async function create() {
    setSaving(true);
    const response = await fetch("/api/private-label-profitability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        name,
        incoterm,
        supplierCurrency,
        analysisCurrency,
        unitCost,
        unitCostSource,
        unitCostAssumedAt,
        moq: Number(moq),
        targetSellingPrice: targetPrice,
        targetPriceSource,
        targetPriceAssumedAt,
        fxRate,
        fxSource,
        fxObservedAt,
        costs: PRIVATE_LABEL_COST_CATEGORIES.map((category) => ({
          category,
          ...costs[category],
        })),
      }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(body.error);
      return;
    }
    setMessage(`Saved ${body.name} v${body.version}.`);
    await load();
  }

  return (
    <main className="content-page">
      <PageHeader
        title="Private-Label Profitability"
        description="Compare sourced supplier quotes with explicit cost allocation, FX evidence, and deterministic stress tests."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Private-label profitability" },
        ]}
      />
      <Alert tone="info" title="Separate deterministic engine">
        This workspace uses private-label-profit/v1 and does not change the
        wholesale profit-engine/v3 formulas. Every cost must be confirmed,
        estimated, or explicitly unknown; unknown costs block calculation.
      </Alert>
      <Card>
        <h2>Project and supplier quote</h2>
        <label htmlFor="pl-project">Private-label research project</label>
        <div className="inline-actions">
          <ProjectPicker
            id="pl-project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={load}
            disabled={!projectId}
          >
            Load scenarios
          </Button>
        </div>
        <label htmlFor="pl-name">Scenario name</label>
        <TextInput
          id="pl-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Supplier A — FOB"
        />
        <label htmlFor="pl-incoterm">Incoterm assumption</label>
        <SelectControl
          id="pl-incoterm"
          value={incoterm}
          onChange={(event) =>
            setIncoterm(event.target.value as "EXW" | "FOB" | "DDP")
          }
        >
          <option>EXW</option>
          <option>FOB</option>
          <option>DDP</option>
        </SelectControl>
        <div className="inline-actions">
          <TextInput
            aria-label="Supplier currency"
            value={supplierCurrency}
            onChange={(event) =>
              setSupplierCurrency(event.target.value.toUpperCase())
            }
            placeholder="Supplier currency"
          />
          <TextInput
            aria-label="Analysis currency"
            value={analysisCurrency}
            onChange={(event) =>
              setAnalysisCurrency(event.target.value.toUpperCase())
            }
            placeholder="Analysis currency"
          />
          <TextInput
            aria-label="Unit cost"
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            placeholder="Unit cost"
            inputMode="decimal"
          />
          <TextInput
            aria-label="MOQ"
            value={moq}
            onChange={(event) => setMoq(event.target.value)}
            placeholder="MOQ"
            inputMode="numeric"
          />
        </div>
        <TextInput
          aria-label="Unit cost source"
          value={unitCostSource}
          onChange={(event) => setUnitCostSource(event.target.value)}
          placeholder="Unit-cost source, e.g. quote ID and date"
        />
        <TextInput
          aria-label="Unit cost assumption date"
          type="date"
          value={unitCostAssumedAt}
          onChange={(event) => setUnitCostAssumedAt(event.target.value)}
        />
        <div className="inline-actions">
          <TextInput
            aria-label="Target selling price"
            value={targetPrice}
            onChange={(event) => setTargetPrice(event.target.value)}
            placeholder="Target selling price"
            inputMode="decimal"
          />
          <TextInput
            aria-label="Target price source"
            value={targetPriceSource}
            onChange={(event) => setTargetPriceSource(event.target.value)}
            placeholder="Target-price source / rationale"
          />
          <TextInput
            aria-label="Target price assumption date"
            type="date"
            value={targetPriceAssumedAt}
            onChange={(event) => setTargetPriceAssumedAt(event.target.value)}
          />
        </div>
        {supplierCurrency !== analysisCurrency ? (
          <div className="inline-actions">
            <TextInput
              aria-label="FX rate"
              value={fxRate}
              onChange={(event) => setFxRate(event.target.value)}
              placeholder={`${supplierCurrency} → ${analysisCurrency} rate`}
            />
            <TextInput
              aria-label="FX source"
              value={fxSource}
              onChange={(event) => setFxSource(event.target.value)}
              placeholder="FX observation source"
            />
            <TextInput
              aria-label="FX observation date"
              type="date"
              value={fxObservedAt}
              onChange={(event) => setFxObservedAt(event.target.value)}
            />
          </div>
        ) : null}
      </Card>
      <Card>
        <h2>Complete cost register</h2>
        <p>
          Amounts are per unit, batch totals, or percentages exactly as
          selected. Each row requires a source and assumption date.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cost</th>
                <th>Allocation</th>
                <th>Amount / %</th>
                <th>Currency</th>
                <th>Confidence</th>
                <th>Source</th>
                <th>Assumed</th>
              </tr>
            </thead>
            <tbody>
              {PRIVATE_LABEL_COST_CATEGORIES.map((category) => (
                <tr key={category}>
                  <td>{category.replaceAll("_", " ")}</td>
                  <td>
                    <SelectControl
                      aria-label={`${category} allocation`}
                      value={costs[category].allocation}
                      onChange={(event) =>
                        updateCost(category, {
                          allocation: event.target
                            .value as CostDraft["allocation"],
                        })
                      }
                    >
                      <option value="PER_UNIT">Per unit</option>
                      <option value="BATCH_TOTAL">Batch total</option>
                      <option value="PERCENT_OF_PRICE">% of price</option>
                    </SelectControl>
                  </td>
                  <td>
                    <TextInput
                      aria-label={`${category} amount`}
                      value={costs[category].amount}
                      onChange={(event) =>
                        updateCost(category, { amount: event.target.value })
                      }
                      inputMode="decimal"
                    />
                  </td>
                  <td>
                    <TextInput
                      aria-label={`${category} currency`}
                      value={costs[category].currency}
                      onChange={(event) =>
                        updateCost(category, {
                          currency: event.target.value.toUpperCase(),
                        })
                      }
                      placeholder={analysisCurrency}
                    />
                  </td>
                  <td>
                    <SelectControl
                      aria-label={`${category} confidence`}
                      value={costs[category].confidence}
                      onChange={(event) =>
                        updateCost(category, {
                          confidence: event.target
                            .value as CostDraft["confidence"],
                        })
                      }
                    >
                      <option value="UNKNOWN">Unknown</option>
                      <option value="ESTIMATED">Estimated</option>
                      <option value="CONFIRMED">Confirmed</option>
                    </SelectControl>
                  </td>
                  <td>
                    <TextInput
                      aria-label={`${category} source`}
                      value={costs[category].source}
                      onChange={(event) =>
                        updateCost(category, { source: event.target.value })
                      }
                      placeholder="Quote / fee / assumption source"
                    />
                  </td>
                  <td>
                    <TextInput
                      aria-label={`${category} assumption date`}
                      type="date"
                      value={costs[category].assumedAt}
                      onChange={(event) =>
                        updateCost(category, {
                          assumedAt: event.target.value,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          onClick={create}
          loading={saving}
          disabled={
            !projectId ||
            !name ||
            !unitCost ||
            !unitCostAssumedAt ||
            !moq ||
            !targetPrice ||
            !targetPriceAssumedAt
          }
        >
          Calculate and save comparison
        </Button>
        {message ? <p role="status">{message}</p> : null}
      </Card>
      {data?.scenarios.length ? (
        <Card>
          <h2>Supplier quote comparison</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Quote</th>
                  <th>Status</th>
                  <th>Landed / unit</th>
                  <th>Net / unit</th>
                  <th>ROI</th>
                  <th>Margin</th>
                  <th>Break-even price</th>
                  <th>Initial cash</th>
                </tr>
              </thead>
              <tbody>
                {data.scenarios.map((scenario) => {
                  const base = scenario.results.find(
                    (result) => result.kind === "BASE",
                  )!;
                  return (
                    <tr key={scenario.id}>
                      <td>
                        {scenario.name} v{scenario.version}
                      </td>
                      <td>
                        {scenario.incoterm} · MOQ {scenario.moq} ·{" "}
                        {scenario.supplierCurrency} {scenario.unitCost}
                      </td>
                      <td>
                        <Badge
                          tone={
                            base.status === "CALCULATED" ? "success" : "danger"
                          }
                        >
                          {base.status}
                        </Badge>
                      </td>
                      <td>
                        {value(base.landedCostPerUnit)} {base.currency}
                      </td>
                      <td>{value(base.netProfitPerUnit)}</td>
                      <td>{value(base.roiPercent)}%</td>
                      <td>{value(base.marginPercent)}%</td>
                      <td>{value(base.breakEvenSalePrice)}</td>
                      <td>{value(base.initialCashRequired)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      {data?.scenarios.map((scenario) => {
        const base = scenario.results.find((result) => result.kind === "BASE");
        if (!base) return null;
        return (
          <Card key={`${scenario.id}-details`}>
            <h2>
              {scenario.name} v{scenario.version}: cost waterfall
            </h2>
            {base.waterfall.length ? (
              <div>
                {base.waterfall.map((item) => (
                  <div key={item.category} className="evidence-list__row">
                    <span>
                      {item.category.replaceAll("_", " ")} · {item.perUnit}{" "}
                      {base.currency}{" "}
                      <Badge
                        tone={
                          item.confidence === "CONFIRMED"
                            ? "success"
                            : "warning"
                        }
                      >
                        {item.confidence}
                      </Badge>
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        height: 8,
                        width: `${Math.min(100, Math.max(2, Number(item.perUnit) * 8))}%`,
                        background: "currentColor",
                        opacity: 0.25,
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p>Waterfall unavailable: {base.reasonCodes.join(", ")}</p>
            )}
            <h3>Sensitivity analysis</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Stress</th>
                    <th>Net / unit</th>
                    <th>ROI</th>
                    <th>Margin</th>
                    <th>Break-even ACoS</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.results
                    .filter((result) => result.kind === "STRESS")
                    .map((result) => (
                      <tr key={result.id}>
                        <td>{result.stressName}</td>
                        <td>{value(result.netProfitPerUnit)}</td>
                        <td>{value(result.roiPercent)}%</td>
                        <td>{value(result.marginPercent)}%</td>
                        <td>{value(result.breakEvenAcosPercent)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {base.uncertainCosts.length ? (
              <Alert tone="warning" title="Estimated costs remain visible">
                {base.uncertainCosts.join(", ")}
              </Alert>
            ) : null}
          </Card>
        );
      })}
    </main>
  );
}
