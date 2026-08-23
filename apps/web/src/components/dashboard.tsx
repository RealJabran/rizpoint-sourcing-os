"use client";

import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Boxes,
  CheckCircle2,
  Clock3,
  Compass,
  FileSpreadsheet,
  FolderKanban,
  History,
  LayoutGrid,
  PackageSearch,
  Radar,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { abortExpectedRequest, requestWasAborted } from "../abort";
import { PageHeader } from "./page-header";
import {
  amazonIntegrationDashboardStatus,
  providerStatusPresentation,
  relativeTimestamp,
  type DashboardSummary,
  type ProviderConnectionStatus,
} from "./dashboard-state";
import { ScanSummaryTable } from "./scan-summary-table";
import { Alert, Badge, ButtonLink, Card, EmptyState, Skeleton } from "./ui";

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

function MetricModule({
  label,
  value,
  detail,
  icon,
  href,
  attention = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  href: string;
  attention?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`dashboard-metric ${attention ? "dashboard-metric--attention" : ""}`}
    >
      <span className="dashboard-metric__icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{value.toLocaleString()}</strong>
        <em>{detail}</em>
      </span>
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

function QuickAction({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <Link href={href} className="dashboard-quick-action">
      <span>{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

function DashboardLoading() {
  return (
    <div className="dashboard-loading" aria-label="Loading dashboard">
      <Skeleton className="dashboard-loading__hero" />
      <div className="dashboard-loading__metrics">
        {["a", "b", "c", "d"].map((key) => (
          <Skeleton key={key} />
        ))}
      </div>
      <div className="dashboard-loading__columns">
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

function ProviderCard({
  amazon,
  history,
}: {
  amazon: ProviderState;
  history: ProviderState;
}) {
  const amazonPresentation =
    amazon.kind === "ready"
      ? providerStatusPresentation(amazon.data.status, amazon.data.mode)
      : null;
  const connected =
    amazon.kind === "ready" &&
    amazon.data.mode === "LIVE" &&
    ["HEALTHY", "AUTHORIZED", "PARTIAL"].includes(amazon.data.status);
  return (
    <Card
      className={`dashboard-connection ${connected ? "dashboard-connection--live" : ""}`}
    >
      <div className="dashboard-connection__glow" aria-hidden="true" />
      <div className="dashboard-connection__top">
        <span className="amazon-provider-mark" aria-hidden="true">
          a
        </span>
        <div>
          <span className="eyebrow">Amazon data layer</span>
          <h2>
            {connected
              ? "Your seller account is connected"
              : (amazonPresentation?.label ?? "Checking Amazon")}
          </h2>
        </div>
        {amazonPresentation ? (
          <Badge tone={amazonPresentation.tone}>
            {amazonPresentation.label}
          </Badge>
        ) : (
          <Skeleton />
        )}
      </div>
      <p>
        {amazonPresentation?.detail ??
          "Confirming organization-scoped connection health…"}
      </p>
      <div className="dashboard-connection__capabilities">
        <span>
          <CheckCircle2 aria-hidden="true" /> Catalog & offers
        </span>
        <span>
          <CheckCircle2 aria-hidden="true" /> Fees & eligibility
        </span>
        <span
          className={
            history.kind === "ready" && history.data.status === "HEALTHY"
              ? ""
              : "is-muted"
          }
        >
          <History aria-hidden="true" /> History{" "}
          {history.kind === "ready" && history.data.status === "HEALTHY"
            ? "connected"
            : "provider required"}
        </span>
      </div>
      <div className="dashboard-connection__footer">
        <span>
          <ShieldCheck aria-hidden="true" /> Encrypted, tenant-scoped access
        </span>
        <ButtonLink
          href="/settings/integrations/amazon"
          variant="secondary"
          size="sm"
        >
          {connected ? "Manage connection" : "Connect Amazon"}{" "}
          <ArrowRight aria-hidden="true" />
        </ButtonLink>
      </div>
    </Card>
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
    const loadJson = async (url: string) => {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("REQUEST_UNAVAILABLE");
      return response.json();
    };
    void loadJson("/api/dashboard/summary")
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((error) => {
        if (active && !requestWasAborted(error, controller.signal))
          setState({ kind: "error" });
      });
    const loadProvider = async (
      url: string,
      name: string,
      setter: (value: ProviderState) => void,
    ) => {
      try {
        const responseData = (await loadJson(url)) as {
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
        if (active) setter({ kind: "ready", data: { ...data, name } });
      } catch (error) {
        if (active && !requestWasAborted(error, controller.signal))
          setter({ kind: "error" });
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
        kicker="Workspace overview"
        title="Your sourcing command center"
        description="Move from supplier files and product ideas to evidence-backed decisions."
        actions={
          <>
            <ButtonLink href="/uploads" variant="secondary">
              <FileSpreadsheet aria-hidden="true" /> New supplier scan
            </ButtonLink>
            <ButtonLink href="/product-research">
              <PackageSearch aria-hidden="true" /> Research product
            </ButtonLink>
          </>
        }
      />
      {state.kind === "loading" ? <DashboardLoading /> : null}
      {state.kind === "error" ? (
        <Alert tone="danger" title="Workspace summary is unavailable">
          No stored data was changed. Refresh when the database connection is
          healthy.
        </Alert>
      ) : null}
      {state.kind === "ready" ? (
        <>
          <div className="dashboard-hero-grid">
            <ProviderCard amazon={provider} history={historyProvider} />
            <Card className="dashboard-next-step">
              <span className="dashboard-next-step__icon">
                <Sparkles aria-hidden="true" />
              </span>
              <span className="eyebrow">Recommended next step</span>
              <h2>
                {state.data.attentionScans
                  ? "Resolve sourcing items that need attention"
                  : state.data.staleEvidence
                    ? "Refresh aging product evidence"
                    : "Research your next product idea"}
              </h2>
              <p>
                {state.data.attentionScans
                  ? `${state.data.attentionScans} scan workflow${state.data.attentionScans === 1 ? "" : "s"} need mapping, retry, or partial-data review.`
                  : state.data.staleEvidence
                    ? `${state.data.staleEvidence} saved product observation${state.data.staleEvidence === 1 ? "" : "s"} are stale or past their freshness window.`
                    : "Start with an ASIN, product URL, barcode, or bounded Amazon catalog search."}
              </p>
              <ButtonLink
                href={
                  state.data.attentionScans ? "/scans" : "/product-research"
                }
                size="sm"
              >
                {state.data.attentionScans ? "Review scans" : "Start research"}{" "}
                <ArrowRight aria-hidden="true" />
              </ButtonLink>
            </Card>
          </div>

          <section className="dashboard-quick-actions" aria-label="Quick start">
            <div className="dashboard-quick-actions__label">
              <span>Quick start</span>
              <small>Open a focused workflow</small>
            </div>
            <QuickAction
              href="/product-research"
              icon={<PackageSearch aria-hidden="true" />}
              label="Research a product"
              detail="ASIN, barcode, or URL"
            />
            <QuickAction
              href="/product-explorer"
              icon={<Compass aria-hidden="true" />}
              label="Explore products"
              detail="Filter your evidence universe"
            />
            <QuickAction
              href="/uploads"
              icon={<FileSpreadsheet aria-hidden="true" />}
              label="Scan supplier file"
              detail="CSV, XLS, or XLSX"
            />
            <QuickAction
              href="/research-projects"
              icon={<LayoutGrid aria-hidden="true" />}
              label="Open projects"
              detail="Compare and decide"
            />
          </section>

          <section className="dashboard-metrics" aria-label="Workspace summary">
            <MetricModule
              label="Active projects"
              value={state.data.activeProjects}
              detail="Evidence-backed decisions"
              href="/research-projects"
              icon={<FolderKanban aria-hidden="true" />}
            />
            <MetricModule
              label="Products watched"
              value={state.data.activeWatches}
              detail="Monitoring scope"
              href="/product-tracker"
              icon={<Radar aria-hidden="true" />}
            />
            <MetricModule
              label="Jobs in progress"
              value={state.data.processingScans}
              detail="Checkpointed workflows"
              href="/scans"
              icon={<Clock3 aria-hidden="true" />}
            />
            <MetricModule
              label="Needs attention"
              value={
                state.data.attentionScans +
                state.data.openAlerts +
                state.data.staleEvidence
              }
              detail="Scans, alerts & stale data"
              href="/alerts"
              attention={Boolean(
                state.data.attentionScans +
                state.data.openAlerts +
                state.data.staleEvidence,
              )}
              icon={<AlertTriangle aria-hidden="true" />}
            />
          </section>

          <div className="dashboard-main-grid">
            <section
              className="dashboard-panel"
              aria-labelledby="recent-research-heading"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Research activity</span>
                  <h2 id="recent-research-heading">Recently researched</h2>
                </div>
                <ButtonLink href="/product-research" variant="quiet" size="sm">
                  View all
                </ButtonLink>
              </div>
              {state.data.recentResearch.length ? (
                <div className="dashboard-activity-list">
                  {state.data.recentResearch.map((run) => {
                    const product = run.items[0]?.catalogProduct;
                    return (
                      <Link href={`/product-research/${run.id}`} key={run.id}>
                        <span className="activity-icon">
                          {run.kind === "CATALOG_SEARCH" ? (
                            <Boxes aria-hidden="true" />
                          ) : (
                            <PackageSearch aria-hidden="true" />
                          )}
                        </span>
                        <span>
                          <strong>{product?.title ?? run.queryText}</strong>
                          <small>
                            {product?.asin ??
                              (run.kind === "CATALOG_SEARCH"
                                ? `${run.resultCount} catalog results`
                                : run.queryType)}{" "}
                            ·{" "}
                            {relativeTimestamp(
                              run.completedAt ?? run.createdAt,
                            )}
                          </small>
                        </span>
                        <Badge
                          tone={
                            run.status === "COMPLETED"
                              ? "success"
                              : run.status === "PARTIAL_SUCCESS"
                                ? "warning"
                                : "info"
                          }
                        >
                          {run.providerMode === "LIVE" ? "Live Amazon" : "Demo"}
                        </Badge>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  compact
                  eyebrow="No research yet"
                  title="Turn an identifier into evidence"
                  description="Research an ASIN, product URL, or barcode without leaving this workspace."
                  icon={<PackageSearch aria-hidden="true" />}
                  actions={
                    <ButtonLink href="/product-research" size="sm">
                      Research product
                    </ButtonLink>
                  }
                />
              )}
            </section>

            <section
              className="dashboard-panel"
              aria-labelledby="changes-heading"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Monitoring</span>
                  <h2 id="changes-heading">Changes that matter</h2>
                </div>
                <ButtonLink href="/alerts" variant="quiet" size="sm">
                  Open alerts
                </ButtonLink>
              </div>
              {state.data.recentAlerts.length ? (
                <div className="dashboard-change-list">
                  {state.data.recentAlerts.map((event) => (
                    <Link href="/alerts" key={event.id}>
                      <BellRing aria-hidden="true" />
                      <span>
                        <strong>
                          {event.alertRule.metricKey
                            .replaceAll("_", " ")
                            .toLowerCase()}
                        </strong>
                        <small>
                          {event.alertRule.subjectType
                            .replaceAll("_", " ")
                            .toLowerCase()}{" "}
                          · {relativeTimestamp(event.triggeredAt)}
                        </small>
                      </span>
                      <Badge
                        tone={event.status === "OPEN" ? "warning" : "neutral"}
                      >
                        {event.status.toLowerCase()}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  eyebrow="All quiet"
                  title="No material changes detected"
                  description="New price, rank, availability, and opportunity events will appear here when supported observations change."
                  icon={<CheckCircle2 aria-hidden="true" />}
                  actions={
                    <ButtonLink
                      href="/product-tracker"
                      variant="secondary"
                      size="sm"
                    >
                      View monitoring
                    </ButtonLink>
                  }
                />
              )}
            </section>
          </div>

          <section
            className="dashboard-panel dashboard-scans"
            aria-labelledby="recent-scans-heading"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">Wholesale sourcing</span>
                <h2 id="recent-scans-heading">Recent supplier scans</h2>
                <p>
                  Latest persisted catalogs and their current workflow
                  checkpoint.
                </p>
              </div>
              <ButtonLink href="/scans" variant="secondary" size="sm">
                View scan history
              </ButtonLink>
            </div>
            {state.data.recentScans.length ? (
              <ScanSummaryTable scans={state.data.recentScans} />
            ) : (
              <EmptyState
                eyebrow="No supplier scans"
                title="Bring in your first supplier catalog"
                description="Upload CSV, XLSX, or XLS. RizPoint will inspect, map, normalize, match, enrich, and calculate without changing the source file."
                icon={<ScanLine aria-hidden="true" />}
                actions={
                  <ButtonLink href="/uploads">
                    Upload supplier catalog
                  </ButtonLink>
                }
              />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
