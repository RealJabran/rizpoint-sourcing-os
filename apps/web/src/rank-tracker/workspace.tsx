"use client";

import { useEffect, useState } from "react";
import { Alert, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { DataStateBadge, SourceBadge } from "@/src/components/research-ui";

type RankStats = {
  latest: number | null;
  change: number | null;
  movingAverage: string | null;
  best: number | null;
  worst: number | null;
  volatility: string | null;
};
type RankGroup = {
  keyword: { id: string; phrase: string; marketplaceId: string };
  calculationVersion: string;
  products: Array<{
    trackId: string;
    asin: string | null;
    title: string;
    cadenceMinutes: number;
    nextRunAt: string | null;
    latestProvider: string | null;
    latestFreshness: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
    observationCount: number;
    organic: RankStats;
    sponsored: RankStats;
    organicShareOfVoicePercent: string | null;
    latestObservedAt: string | null;
  }>;
};
type Response = {
  total: number;
  universe: string;
  capabilityStates: Array<{
    providerKey: string;
    mode: string;
    state: string;
    reason?: string;
  }>;
  groups: RankGroup[];
};

export function RankTrackerWorkspace() {
  const [data, setData] = useState<Response | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetch("/api/rank-tracker", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("RANK_TRACKER_UNAVAILABLE");
        setData(await response.json());
      })
      .catch(() => setFailed(true));
  }, []);
  const available = data?.capabilityStates.some((state) =>
    ["AUTHORIZED", "HEALTHY"].includes(state.state),
  );

  return (
    <main className="content-page page-stack">
      <PageHeader
        title="Keyword rank tracker"
        description="Stored organic and sponsored rank observations with deterministic trend and share-of-voice calculations."
        breadcrumbs={[
          { label: "Keyword Explorer", href: "/keyword-explorer" },
          { label: "Rank tracker" },
        ]}
      />
      {failed ? (
        <Alert tone="danger" title="Rank tracker unavailable">
          Stored rank observations could not be loaded.
        </Alert>
      ) : (
        <Alert
          tone={available ? "info" : "warning"}
          title={
            available
              ? "SearchRankProvider capability recorded"
              : "No authorized SearchRankProvider configured"
          }
        >
          {available
            ? "Collection remains quota-aware and scheduled outside page loads. Provider status does not guarantee that every keyword has an observation."
            : "No new tracking jobs can collect rank. Existing observations remain visible and are never zeroed after quota or provider failure."}
        </Alert>
      )}
      {failed ? (
        <Card className="empty-state">
          <h2>Stored rank data could not be loaded</h2>
          <p>
            Try again later. Missing provider data has not been treated as zero.
          </p>
        </Card>
      ) : !data ? (
        <Card>
          <p role="status">Loading stored rank tracks…</p>
        </Card>
      ) : data.groups.length ? (
        <>
          <Alert tone="info" title={`${data.total} stored tracks in scope`}>
            {data.universe}
          </Alert>
          {data.groups.map((group) => (
            <Card key={group.keyword.id}>
              <div className="section-heading">
                <div>
                  <h2>{group.keyword.phrase}</h2>
                  <p>
                    {group.keyword.marketplaceId} · {group.calculationVersion}
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Organic rank</th>
                      <th scope="col">7-observation average</th>
                      <th scope="col">Volatility</th>
                      <th scope="col">Share of voice</th>
                      <th scope="col">Source / observed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.products.map((product) => (
                      <tr key={product.trackId}>
                        <td>
                          {product.title}
                          <small>
                            {product.asin ?? "ASIN unavailable"} ·{" "}
                            {product.observationCount} observations
                          </small>
                        </td>
                        <td>
                          {product.organic.latest ?? "Unavailable"}
                          <small>
                            {product.organic.change === null
                              ? "No prior observation"
                              : `${product.organic.change >= 0 ? "+" : ""}${product.organic.change} change`}
                          </small>
                        </td>
                        <td>
                          {product.organic.movingAverage ?? "Unavailable"}
                        </td>
                        <td>{product.organic.volatility ?? "Unavailable"}</td>
                        <td>
                          {product.organicShareOfVoicePercent
                            ? `${product.organicShareOfVoicePercent}%`
                            : "Unavailable"}
                        </td>
                        <td>
                          <div className="badge-stack">
                            <SourceBadge
                              source={
                                product.latestProvider ?? "Source unavailable"
                              }
                            />
                            <DataStateBadge
                              state={
                                product.latestFreshness === "FRESH"
                                  ? "CURRENT"
                                  : product.latestFreshness === "STALE"
                                    ? "STALE"
                                    : "MISSING"
                              }
                            />
                          </div>
                          <small>
                            {product.latestObservedAt ?? "No observation time"}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      ) : (
        <Card className="empty-state">
          <h2>No stored rank tracks</h2>
          <p>
            An authorized SearchRankProvider is required before a daily or
            weekly track can collect observations. No rank is inferred from
            Amazon HTML.
          </p>
        </Card>
      )}
    </main>
  );
}
