"use client";

import Link from "next/link";
import { Card } from "@/src/components/ui";
import {
  DataStateBadge,
  MetricValue,
  SourceBadge,
  ViewToggle,
} from "@/src/components/research-ui";

export type NicheSummary = {
  id: string;
  name: string;
  marketplaceId: string;
  sourceType: string;
  score: string | null;
  confidencePercent: string | null;
  status: string;
  calculatedAt: string | null;
};

export function NicheResults({
  rows,
  view,
  onViewChange,
}: {
  rows: NicheSummary[];
  view: "table" | "chart";
  onViewChange(value: "table" | "chart"): void;
}) {
  return (
    <Card className="niche-results">
      <div className="section-heading">
        <div>
          <h2>Saved niches</h2>
          <p>Deterministic score snapshots in the selected date window.</p>
        </div>
        <ViewToggle value={view} onChange={onViewChange} />
      </div>
      {!rows.length ? (
        <div className="empty-state">
          <h3>No niches in this window</h3>
          <p>
            Define one from tracked category, keyword evidence, competitor set,
            or a market definition.
          </p>
        </div>
      ) : view === "chart" ? (
        <div
          className="niche-chart"
          role="img"
          aria-label="Opportunity scores by niche"
        >
          {rows.map((niche) => (
            <div className="niche-bar" key={niche.id}>
              <span>{niche.name}</span>
              <div>
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(niche.score ?? 0)))}%`,
                  }}
                />
              </div>
              <strong>{niche.score ?? "—"}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Niche</th>
                <th scope="col">Definition</th>
                <th scope="col">Opportunity score</th>
                <th scope="col">Confidence</th>
                <th scope="col">Evidence state</th>
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
                  <td>
                    <MetricValue
                      label="Score"
                      value={niche.score}
                      source="RizPoint opportunity scorer"
                      window="Stored assessment snapshot"
                      observedAt={niche.calculatedAt}
                      state={
                        niche.score === null
                          ? "MISSING"
                          : niche.status === "PARTIAL"
                            ? "PARTIAL"
                            : "CURRENT"
                      }
                    />
                  </td>
                  <td>
                    {niche.confidencePercent === null
                      ? "Unavailable"
                      : `${niche.confidencePercent}%`}
                  </td>
                  <td>
                    <div className="badge-stack">
                      <DataStateBadge
                        state={
                          niche.status === "PARTIAL"
                            ? "PARTIAL"
                            : niche.score === null
                              ? "MISSING"
                              : "CURRENT"
                        }
                      />
                      <SourceBadge source="Deterministic assessment" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
