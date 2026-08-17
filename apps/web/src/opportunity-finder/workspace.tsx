"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  SelectControl,
  TextInput,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Niche = {
  id: string;
  name: string;
  marketplaceId: string;
  sourceType: string;
  score: string | null;
  confidencePercent: string | null;
  status: string;
  calculatedAt: string | null;
};
export function OpportunityFinder() {
  const { notify } = useToast();
  const [rows, setRows] = useState<Niche[]>([]);
  const [name, setName] = useState("");
  const [marketplaceId, setMarketplaceId] = useState("");
  const [sourceType, setSourceType] = useState("CATEGORY");
  const [value, setValue] = useState("");
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
      <Card className="explorer-controls">
        <h2>Define a niche</h2>
        <div className="explorer-filter-grid">
          <TextInput
            placeholder="Niche name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextInput
            placeholder="Marketplace ID"
            value={marketplaceId}
            onChange={(e) => setMarketplaceId(e.target.value)}
          />
          <SelectControl
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
            placeholder="Category, keyword(s), product IDs, or market ID"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button onClick={() => void create()}>Create & calculate</Button>
        </div>
        <p>
          Keyword clusters and manual competitor IDs use comma-separated values.
          Only stored/authorized products can become score inputs.
        </p>
      </Card>
      <Card>
        <h2>Saved niches</h2>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Niche</th>
                  <th>Source</th>
                  <th>Score</th>
                  <th>Confidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((niche) => (
                  <tr key={niche.id}>
                    <td>
                      <Link href={`/opportunity-finder/${niche.id}`}>
                        {niche.name}
                      </Link>
                      <small>{niche.marketplaceId}</small>
                    </td>
                    <td>{niche.sourceType}</td>
                    <td>{niche.score ?? "Not calculated"}</td>
                    <td>
                      {niche.confidencePercent === null
                        ? "—"
                        : `${niche.confidencePercent}%`}
                    </td>
                    <td>{niche.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No niches yet. Define one from your tracked category, keyword
            evidence, competitor set, or market definition.
          </p>
        )}
      </Card>
    </main>
  );
}
