"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, TextInput, useToast } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { DataStateBadge, SourceBadge } from "@/src/components/research-ui";

type TrackerRow = {
  id: string;
  status: string;
  marketplaceId: string;
  cadenceMinutes: number;
  nextObservationAt: string | null;
  lastObservedAt: string | null;
  project: { id: string; name: string } | null;
  product: {
    id: string;
    asin: string | null;
    title: string;
    brand: string | null;
    source: string;
    observedAt: string;
    freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  };
  demandEstimate: {
    monthlyUnitsLow: string;
    monthlyUnitsHigh: string;
    confidencePercent: string | null;
    source: string;
    providerKey: string | null;
    modelVersion: string;
    observedAt: string;
  } | null;
  history: {
    providerKey: string;
    calculationVersion: string;
    status: string;
    windowStart: string | null;
    windowEnd: string;
    coveragePercent: string | null;
    calculatedAt: string;
  } | null;
};

type TrackerResponse = {
  total: number;
  universe: string;
  rows: TrackerRow[];
};

function cadence(minutes: number) {
  if (minutes % 10_080 === 0) {
    const weeks = minutes / 10_080;
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

export function ProductTrackerWorkspace() {
  const { notify } = useToast();
  const [marketplaceId, setMarketplaceId] = useState("");
  const [data, setData] = useState<TrackerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (marketplaceId.trim()) params.set("marketplaceId", marketplaceId.trim());
    try {
      setFailed(false);
      const response = await fetch(`/api/product-tracker?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "PRODUCT_TRACKER_UNAVAILABLE");
      setData(payload);
    } catch (error) {
      setFailed(true);
      notify(
        error instanceof Error ? error.message : "PRODUCT_TRACKER_UNAVAILABLE",
        "danger",
      );
    } finally {
      setLoading(false);
    }
  }, [marketplaceId, notify]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <main className="content-page page-stack">
      <PageHeader
        title="Product Tracker"
        description="Persistent watched products over stored, source-labeled observations. Page loads never call a provider."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Product Tracker" },
        ]}
      />
      <Alert tone="info" title="Tracked universe, not Amazon-wide coverage">
        {data?.universe ??
          "Only organization-owned ProductWatch records are queried. Missing observations stay unavailable."}
      </Alert>
      <Card>
        <div className="explorer-filter-grid">
          <TextInput
            aria-label="Marketplace ID"
            placeholder="Marketplace ID (optional)"
            value={marketplaceId}
            onChange={(event) => setMarketplaceId(event.target.value)}
          />
          <Button type="button" onClick={() => void load()} loading={loading}>
            Refresh stored watches
          </Button>
        </div>
      </Card>
      <Card>
        <div className="section-heading">
          <div>
            <h2>Watched products</h2>
            <p>
              Showing {data?.rows.length ?? 0} of {data?.total ?? 0} watches in
              this exact filtered universe.
            </p>
          </div>
        </div>
        {failed && !data ? (
          <div className="empty-state">
            <h3>Stored watches could not be loaded</h3>
            <p>
              Try again later. Missing observations have not been treated as
              zero.
            </p>
          </div>
        ) : loading && !data ? (
          <p role="status">Loading stored watches…</p>
        ) : data?.rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Watch</th>
                  <th scope="col">Demand range</th>
                  <th scope="col">History coverage</th>
                  <th scope="col">Source / observed</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.product.title}</strong>
                      <small>
                        {row.product.asin ?? "ASIN unavailable"} ·{" "}
                        {row.product.brand ?? "Brand unavailable"}
                      </small>
                      {row.project ? (
                        <Link
                          href={`/research-projects?projectId=${encodeURIComponent(row.project.id)}`}
                        >
                          {row.project.name}
                        </Link>
                      ) : null}
                    </td>
                    <td>
                      {row.status} · every {cadence(row.cadenceMinutes)}
                      <small>
                        Last collected: {row.lastObservedAt ?? "Never"}
                      </small>
                    </td>
                    <td>
                      {row.demandEstimate
                        ? `${row.demandEstimate.monthlyUnitsLow}–${row.demandEstimate.monthlyUnitsHigh} units`
                        : "Unavailable"}
                      <small>
                        {row.demandEstimate
                          ? `${row.demandEstimate.source} · ${row.demandEstimate.modelVersion}`
                          : "No licensed or calibrated estimate"}
                      </small>
                    </td>
                    <td>
                      {row.history?.coveragePercent
                        ? `${row.history.coveragePercent}%`
                        : "Unavailable"}
                      <small>
                        {row.history
                          ? `${row.history.status} · ${row.history.calculationVersion}`
                          : "No history assessment"}
                      </small>
                    </td>
                    <td>
                      <div className="badge-stack">
                        <SourceBadge
                          source={
                            row.history?.providerKey ??
                            row.demandEstimate?.providerKey ??
                            row.product.source
                          }
                        />
                        <DataStateBadge
                          state={
                            row.product.freshnessState === "FRESH"
                              ? "CURRENT"
                              : row.product.freshnessState === "STALE"
                                ? "STALE"
                                : row.product.freshnessState === "EXPIRED"
                                  ? "STALE"
                                  : "MISSING"
                          }
                        />
                      </div>
                      <small>
                        {row.history?.calculatedAt ??
                          row.demandEstimate?.observedAt ??
                          row.product.observedAt}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No watched products</h3>
            <p>
              Save a known product to the watchlist. Collection remains
              provider-gated and missing metrics will not be zero-filled.
            </p>
            <Link
              className="rp-button rp-button--primary rp-button--md"
              href="/product-explorer"
            >
              Open Product Explorer
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}
