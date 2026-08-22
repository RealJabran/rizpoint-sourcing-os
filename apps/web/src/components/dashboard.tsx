"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "./page-header";
import {
  amazonIntegrationDashboardStatus,
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
      data: {
        name: string;
        status: ProviderConnectionStatus;
        mode: "MOCK" | "LIVE";
        checkedAt: string;
      };
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
  const [historyProvider, setHistoryProvider] = useState<ProviderState>({
    kind: "loading",
  });
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
    const loadProvider = async (
      url: string,
      name: string,
      setProviderState: (value: ProviderState) => void,
    ) => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("PROVIDER_STATUS_UNAVAILABLE");
        const responseData = (await response.json()) as {
          status: ProviderConnectionStatus;
          mode: "MOCK" | "LIVE";
          checkedAt: string;
          connectionState?: string;
          dataOrigin?: string;
          localDemo?: boolean;
          connection?: { lastValidatedAt?: string | null } | null;
        };
        const data =
          name === "Amazon" && responseData.connectionState
            ? amazonIntegrationDashboardStatus(responseData)
            : responseData;
        if (active)
          setProviderState({ kind: "ready", data: { ...data, name } });
      } catch (error) {
        if (!active || requestWasAborted(error, controller.signal)) return;
        setProviderState({ kind: "error" });
      }
    };
    void loadProvider("/api/providers/amazon", "Amazon", setProvider);
    void loadProvider(
      "/api/providers/market-history",
      "Market history",
      setHistoryProvider,
    );
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
          <section className="dashboard-provider" aria-label="Provider status">
            <div>
              <span className="dashboard-provider__eyebrow">
                Provider truth
              </span>
              <h2>Data connections</h2>
            </div>
            {[provider, historyProvider].map((connection, index) => (
              <div
                className="dashboard-provider__status"
                key={index}
                role="region"
                aria-label={
                  connection.kind === "ready"
                    ? `${connection.data.name} provider status`
                    : "Provider status"
                }
              >
                {connection.kind === "loading" ? (
                  <Skeleton className="provider-skeleton" />
                ) : null}
                {connection.kind === "error" ? (
                  <Alert tone="warning" title="Provider status is unavailable">
                    This provider could not be confirmed. Persisted data is
                    unchanged.
                  </Alert>
                ) : null}
                {connection.kind === "ready"
                  ? (() => {
                      const presentation = providerStatusPresentation(
                        connection.data.status,
                        connection.data.mode,
                      );
                      return (
                        <>
                          <strong>{connection.data.name}</strong>
                          <Badge tone={presentation.tone}>
                            {presentation.label}
                          </Badge>
                          <p>{presentation.detail}</p>
                        </>
                      );
                    })()
                  : null}
              </div>
            ))}
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
