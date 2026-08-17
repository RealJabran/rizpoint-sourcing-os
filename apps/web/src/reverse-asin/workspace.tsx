"use client";
import { useState } from "react";
import { Alert, Button, Card, TextInput } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Row = {
  phrase: string;
  provider: string;
  observedAt: string[];
  rankingAsinCount: number;
  averageOrganicRank: string | null;
  competitorGap: boolean;
  matrix: Record<
    string,
    {
      organicRank: number | null;
      sponsoredRank: number | null;
      observedAt: string;
    }
  >;
};
export function ReverseAsinWorkspace() {
  const [asins, setAsins] = useState("");
  const [mineAsin, setMineAsin] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const run = async () => {
    const response = await fetch("/api/reverse-asin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asins: asins.split(/[,\s]+/).filter(Boolean),
        mineAsin: mineAsin || undefined,
      }),
    });
    if (response.ok) setRows(await response.json());
  };
  return (
    <main className="content-page">
      <PageHeader
        title="Reverse ASIN gap"
        description="Keyword ranks only from licensed stored provider observations."
        breadcrumbs={[
          { label: "Keyword Explorer", href: "/keyword-explorer" },
          { label: "Reverse ASIN" },
        ]}
      />
      <Alert tone="info" title="No scraped rank data">
        Missing cells mean the provider did not observe a rank; they are never
        converted to zero.
      </Alert>
      <Card className="explorer-controls">
        <div className="explorer-filter-grid">
          <TextInput
            placeholder="1–10 ASINs, comma separated"
            value={asins}
            onChange={(e) => setAsins(e.target.value.toUpperCase())}
          />
          <TextInput
            placeholder="My ASIN (optional)"
            value={mineAsin}
            onChange={(e) => setMineAsin(e.target.value.toUpperCase())}
          />
          <Button onClick={() => void run()}>Compare keywords</Button>
        </div>
      </Card>
      <Card>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Ranking ASINs</th>
                  <th>Avg rank</th>
                  <th>Gap</th>
                  <th>Provider</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.phrase}>
                    <td>{row.phrase}</td>
                    <td>{row.rankingAsinCount}</td>
                    <td>{row.averageOrganicRank ?? "—"}</td>
                    <td>
                      {row.competitorGap
                        ? "All competitors rank; mine does not"
                        : "—"}
                    </td>
                    <td>{row.provider}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No licensed reverse-ASIN observations yet.</p>
        )}
      </Card>
    </main>
  );
}
