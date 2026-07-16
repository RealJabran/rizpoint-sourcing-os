"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "./page-header";
import {
  providerStatusPresentation,
  type DashboardSummary,
  type ProviderConnectionStatus,
} from "./dashboard-state";
import { ScanSummaryTable } from "./scan-summary-table";
import { Alert, Badge, ButtonLink, Card, Skeleton } from "./ui";
import { abortExpectedRequest, requestWasAborted } from "../abort";

type DashboardState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: DashboardSummary };

type ProviderState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      data: { status: ProviderConnectionStatus; checkedAt: string };
    };

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "info" | "warning";
}) {
  return (
    <Card className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <Badge tone={tone}>{detail}</Badge>
    </Card>
  );
}

function DashboardLoading() {
  return (
    <>
      <div className="metric-grid" aria-label="Loading dashboard metrics">
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="metric-skeleton" />
        ))}
      </div>
      <Card className="dashboard-section">
        <Skeleton className="table-skeleton" />
      </Card>
    </>
  );
}

export function Dashboard() {
  const [state, setState] = useState<DashboardState>({ kind: "loading" });
  const [provider, setProvider] = useState<ProviderState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/dashboard/summary", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("DASHBOARD_UNAVAILABLE");
        const data = (await response.json()) as DashboardSummary;
        if (active) setState({ kind: "ready", data });
      } catch (error) {
        if (!active || requestWasAborted(error, controller.signal)) return;
        setState({ kind: "error" });
      }
    })();
    void (async () => {
      try {
        const response = await fetch("/api/providers/amazon", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("PROVIDER_STATUS_UNAVAILABLE");
        const data = (await response.json()) as {
          status: ProviderConnectionStatus;
          checkedAt: string;
        };
        if (active) setProvider({ kind: "ready", data });
      } catch (error) {
        if (!active || requestWasAborted(error, controller.signal)) return;
        setProvider({ kind: "error" });
      }
    })();
    return () => {
      active = false;
      abortExpectedRequest(controller);
    };
  }, []);

  return (
    <main className="dashboard-page">
      <PageHeader
        title="Sourcing dashboard"
        description="Track catalog work that is persisted in this workspace. Decisions remain evidence-led."
        actions={<ButtonLink href="/uploads">New scan</ButtonLink>}
      />
      {state.kind === "loading" ? <DashboardLoading /> : null}
      {state.kind === "error" ? (
        <Alert tone="danger" title="Dashboard data is unavailable">
          Your catalog data was not changed. Refresh the page to try again.
        </Alert>
      ) : null}
      {state.kind === "ready" ? (
        <>
          <section
            className="dashboard-provider"
            aria-label="Amazon provider status"
          >
            <div>
              <span className="dashboard-provider__eyebrow">Amazon data</span>
              <h2>Provider connection</h2>
            </div>
            {provider.kind === "loading" ? (
              <Skeleton className="provider-skeleton" />
            ) : null}
            {provider.kind === "error" ? (
              <Alert tone="warning" title="Provider status is unavailable">
                Amazon data status could not be confirmed. Your persisted scan
                data is unchanged.
              </Alert>
            ) : null}
            {provider.kind === "ready"
              ? (() => {
                  const presentation = providerStatusPresentation(
                    provider.data.status,
                  );
                  return (
                    <div className="dashboard-provider__status">
                      <Badge tone={presentation.tone}>
                        {presentation.label}
                      </Badge>
                      <p>{presentation.detail}</p>
                    </div>
                  );
                })()
              : null}
          </section>
          <section className="metric-grid" aria-label="Catalog scan summary">
            <MetricCard
              label="Catalog scans"
              value={state.data.totalScans}
              detail="Persisted scans"
              tone="neutral"
            />
            <MetricCard
              label="Processing"
              value={state.data.processingScans}
              detail="Checkpointed jobs"
              tone="info"
            />
            <MetricCard
              label="Needs attention"
              value={state.data.attentionScans}
              detail="Review workflow state"
              tone="warning"
            />
          </section>
          {state.data.attentionScans ? (
            <Alert tone="warning" title="Some scans need a next step">
              Mapping, retry, partial-data, and terminal-failure states are
              counted here. Open the scan list to inspect persisted status.
            </Alert>
          ) : null}
          <section
            className="dashboard-section"
            aria-labelledby="recent-scans-heading"
          >
            <div className="section-heading">
              <div>
                <h2 id="recent-scans-heading">Recent catalog scans</h2>
                <p>
                  Latest persisted scan jobs. No revenue, profit, or winner
                  metrics are inferred here.
                </p>
              </div>
              <ButtonLink href="/scans" variant="secondary" size="sm">
                View scan list
              </ButtonLink>
            </div>
            {state.data.recentScans.length ? (
              <ScanSummaryTable scans={state.data.recentScans} />
            ) : (
              <div className="empty-state">
                <span className="empty-state__eyebrow">
                  No catalog scans yet
                </span>
                <h3>Start with a supplier catalog.</h3>
                <p>
                  Upload a CSV, XLSX, or XLS file to inspect its structure and
                  map supplier fields.
                </p>
                <ButtonLink href="/uploads">Start a new scan</ButtonLink>
              </div>
            )}
          </section>
          <section
            className="dashboard-guidance"
            aria-labelledby="workflow-heading"
          >
            <h2 id="workflow-heading">The RizPoint workflow</h2>
            <ol>
              <li>
                <strong>Import</strong>
                <span>
                  Inspect the catalog before any supplier row is accepted.
                </span>
              </li>
              <li>
                <strong>Verify</strong>
                <span>
                  Resolve matches, pack evidence, restrictions, and freshness.
                </span>
              </li>
              <li>
                <strong>Decide</strong>
                <span>
                  Review deterministic scenarios before shortlisting or
                  ordering.
                </span>
              </li>
            </ol>
          </section>
        </>
      ) : null}
    </main>
  );
}
