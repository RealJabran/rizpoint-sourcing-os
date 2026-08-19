"use client";

import { useState } from "react";
import { Button, Card } from "@/src/components/ui";
import {
  DataStateBadge,
  EvidenceDrawer,
  MetricValue,
  SourceBadge,
} from "@/src/components/research-ui";
import { explorerDataState } from "./query";
import type { ExplorerRow } from "./types";

export function ExplorerResultsTable({
  rows,
  loading,
  selected,
  compare,
  onSelect,
  onCompare,
}: {
  rows: ExplorerRow[];
  loading: boolean;
  selected: string[];
  compare: string[];
  onSelect(id: string): void;
  onCompare(id: string): void;
}) {
  const [evidence, setEvidence] = useState<ExplorerRow | null>(null);
  return (
    <>
      <Card className="explorer-results">
        {loading ? (
          <p role="status">Loading a 50-product server window…</p>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__eyebrow">
              No eligible product evidence yet
            </span>
            <h2>There are no products in this filtered private universe.</h2>
            <p>
              Import/match a supplier catalog, save products to a research
              project, or run an authorized history refresh. Product Explorer
              never invents a wider Amazon universe.
            </p>
          </div>
        ) : (
          <div className="explorer-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Select</th>
                  <th scope="col">Product</th>
                  <th scope="col">Observed metrics</th>
                  <th scope="col">Source & state</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        aria-label={`Select ${row.title}`}
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        onChange={() => onSelect(row.id)}
                      />
                    </td>
                    <td>
                      <strong>{row.title}</strong>
                      <small>
                        {row.asin ?? "ASIN unavailable"} ·{" "}
                        {row.brand ?? "Brand unavailable"}
                        {row.category ? ` · ${row.category}` : ""}
                      </small>
                    </td>
                    <td>
                      <div className="table-metric-grid">
                        <MetricValue
                          label="Price"
                          value={row.price}
                          unit={row.currency ?? ""}
                          source={row.sources[0] ?? null}
                          window="Latest observation"
                          observedAt={row.observedAt}
                          state={explorerDataState(
                            row.freshnessState,
                            row.price,
                          )}
                        />
                        <MetricValue
                          label="Reviews"
                          value={row.reviewCount}
                          source={row.sources[0] ?? null}
                          window="Latest observation"
                          observedAt={row.observedAt}
                          state={explorerDataState(
                            row.freshnessState,
                            row.reviewCount,
                          )}
                        />
                        <MetricValue
                          label="90d volatility"
                          value={row.priceVolatilityPercent}
                          unit="%"
                          source="RizPoint history analytics"
                          window="90 days"
                          observedAt={row.observedAt}
                          state={explorerDataState(
                            row.historyStatus,
                            row.priceVolatilityPercent,
                          )}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="badge-stack">
                        {row.sources.map((source) => (
                          <SourceBadge
                            key={source}
                            source={source
                              .replaceAll("_", " ")
                              .toLocaleLowerCase("en-US")}
                          />
                        ))}
                        <DataStateBadge
                          state={explorerDataState(
                            row.freshnessState,
                            row.observedAt,
                          )}
                        />
                      </div>
                    </td>
                    <td>
                      <label className="compact-check">
                        <input
                          aria-label={`Compare ${row.title}`}
                          type="checkbox"
                          checked={compare.includes(row.id)}
                          disabled={
                            !compare.includes(row.id) && compare.length >= 4
                          }
                          onChange={() => onCompare(row.id)}
                        />{" "}
                        Compare
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="quiet"
                        onClick={() => setEvidence(row)}
                      >
                        Evidence
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <EvidenceDrawer
        open={evidence !== null}
        title={evidence?.title ?? "Product evidence"}
        onClose={() => setEvidence(null)}
      >
        {evidence ? (
          <div className="page-stack">
            <p>
              <strong>ASIN:</strong> {evidence.asin ?? "Unavailable"}
            </p>
            <p>
              <strong>Observed:</strong>{" "}
              {evidence.observedAt
                ? new Date(evidence.observedAt).toLocaleString()
                : "Unavailable"}
            </p>
            <p>
              <strong>Freshness:</strong> {evidence.freshnessState ?? "Unknown"}
            </p>
            <p>
              <strong>History coverage:</strong>{" "}
              {evidence.historyCoveragePercent !== null
                ? `${evidence.historyCoveragePercent}%`
                : "Unavailable"}
            </p>
            <div className="badge-stack">
              {evidence.sources.map((source) => (
                <SourceBadge key={source} source={source} />
              ))}
            </div>
            <p className="muted-copy">
              Only normalized, authorized evidence is shown here. Raw provider
              payloads remain private.
            </p>
          </div>
        ) : null}
      </EvidenceDrawer>
    </>
  );
}
