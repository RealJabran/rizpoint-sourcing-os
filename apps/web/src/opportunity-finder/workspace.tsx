"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  SelectControl,
  TextInput,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { DateWindowControl, FilterBar } from "@/src/components/research-ui";
import { NicheResults, type NicheSummary } from "./niche-results";
export function OpportunityFinder() {
  const { notify } = useToast();
  const [rows, setRows] = useState<NicheSummary[]>([]);
  const [name, setName] = useState("");
  const [marketplaceId, setMarketplaceId] = useState("");
  const [sourceType, setSourceType] = useState("CATEGORY");
  const [value, setValue] = useState("");
  const [window, setWindow] = useState("365d");
  const [view, setView] = useState<"table" | "chart">("table");
  const visibleRows = useMemo(() => {
    const days = Number.parseInt(window, 10);
    const anchor = rows.reduce(
      (latest, row) =>
        Math.max(
          latest,
          row.calculatedAt ? new Date(row.calculatedAt).getTime() : 0,
        ),
      0,
    );
    const cutoff = anchor - days * 86_400_000;
    return rows.filter(
      (row) =>
        row.calculatedAt === null ||
        new Date(row.calculatedAt).getTime() >= cutoff,
    );
  }, [rows, window]);
  const load = async () => {
    const response = await fetch("/api/opportunity-finder");
    if (response.ok) setRows((await response.json()).rows);
  };
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);
  const create = async () => {
    const response = await fetch("/api/opportunity-finder/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "CREATE",
        name,
        marketplaceId,
        sourceType,
        value,
      }),
    });
    const data = await response.json();
    if (!response.ok)
      return notify(data.error ?? "Could not create niche", "danger");
    notify("Niche calculated from stored evidence.");
    setName("");
    setValue("");
    void load();
  };
  return (
    <main className="content-page">
      <PageHeader
        title="Opportunity Finder"
        description="Define and compare evidence-bounded niches, not a claimed global Amazon market."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Opportunity Finder" },
        ]}
      />
      <Alert tone="info" title="Explainable, low-data-aware scoring">
        Scores use deterministic stored review, price-history, Amazon Retail,
        listing-age, and brand facts. Demand, sales, seller concentration,
        sponsored density, and margin are unavailable until
        licensed/assumption-backed inputs exist.
      </Alert>
      <FilterBar
        label="Define a niche"
        actions={<DateWindowControl value={window} onChange={setWindow} />}
      >
        <div className="explorer-controls">
          <h2>Define a niche</h2>
          <div className="explorer-filter-grid">
            <TextInput
              aria-label="Niche name"
              placeholder="Niche name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextInput
              aria-label="Marketplace ID"
              placeholder="Marketplace ID"
              value={marketplaceId}
              onChange={(e) => setMarketplaceId(e.target.value)}
            />
            <SelectControl
              aria-label="Niche source type"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
            >
              {[
                "CATEGORY",
                "SEED_KEYWORD",
                "KEYWORD_CLUSTER",
                "MANUAL_COMPETITORS",
                "MARKET_DEFINITION",
              ].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </SelectControl>
            <TextInput
              aria-label="Niche source value"
              placeholder="Category, keyword(s), product IDs, or market ID"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button onClick={() => void create()}>Create & calculate</Button>
          </div>
          <p>
            Keyword clusters and manual competitor IDs use comma-separated
            values. Only stored/authorized products can become score inputs.
          </p>
        </div>
      </FilterBar>
      <NicheResults rows={visibleRows} view={view} onViewChange={setView} />
    </main>
  );
}
