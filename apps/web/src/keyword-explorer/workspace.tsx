"use client";
import { useState } from "react";
import { Alert, Button, Card, TextInput } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Row = {
  id: string;
  phrase: string;
  normalizedPhrase: string;
  searchVolume: string | null;
  competingProductCount: string | null;
  suggestedBid: string | null;
  provider: string | null;
  observedAt: string | null;
  completeness: string;
};
export function KeywordExplorer() {
  const [seed, setSeed] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = async () => {
    const response = await fetch(
      `/api/keyword-explorer?search=${encodeURIComponent(seed)}`,
    );
    if (response.ok) {
      setRows((await response.json()).rows);
      setLoaded(true);
    }
  };
  return (
    <main className="content-page">
      <PageHeader
        title="Keyword Explorer"
        description="Stored, licensed keyword observations only."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Keyword Explorer" },
        ]}
      />
      <Alert tone="info" title="Provider required for discovery">
        No licensed keyword provider is configured in this workspace. Search
        shows existing provider observations only; it never invents search
        volume.
      </Alert>
      <Card className="explorer-controls">
        <div className="explorer-filter-grid">
          <TextInput
            placeholder="Seed keyword"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
          />
          <Button onClick={() => void load()}>Search stored keywords</Button>
        </div>
      </Card>
      {loaded ? (
        <Card>
          <h2>Keyword observations</h2>
          {rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Volume</th>
                    <th>Competition</th>
                    <th>Bid</th>
                    <th>Provider / observed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.phrase}
                        <small>Normalized: {row.normalizedPhrase}</small>
                      </td>
                      <td>{row.searchVolume ?? "Unavailable"}</td>
                      <td>{row.competingProductCount ?? "Unavailable"}</td>
                      <td>{row.suggestedBid ?? "Unavailable"}</td>
                      <td>
                        {row.provider ?? "No provider"}
                        <small>{row.observedAt ?? row.completeness}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              No stored observations match. Connect an authorized
              KeywordIntelligenceProvider to discover seed terms, related
              clusters, and history.
            </p>
          )}
        </Card>
      ) : null}
    </main>
  );
}
