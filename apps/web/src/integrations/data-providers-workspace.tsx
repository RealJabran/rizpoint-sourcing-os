"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import { Alert, Badge, Button, Card, Skeleton } from "@/src/components/ui";

type UsageSummary = {
  since: string;
  liveProviderCalls: number;
  cacheHits: number;
  cacheMisses: number;
  staleHits: number;
  refreshes: number;
  throttles: number;
  estimatedUsage: Array<{ unit: string; value: string }>;
  estimatedCost: Array<{ currency: string; value: string }>;
  providers: string[];
};

const metrics: Array<{
  key: keyof Pick<
    UsageSummary,
    | "liveProviderCalls"
    | "cacheHits"
    | "cacheMisses"
    | "staleHits"
    | "refreshes"
    | "throttles"
  >;
  label: string;
  detail: string;
}> = [
  {
    key: "liveProviderCalls",
    label: "Live provider calls",
    detail: "Requests that reached a configured live provider.",
  },
  {
    key: "cacheHits",
    label: "Fresh cache hits",
    detail: "Provider calls avoided by reusable stored evidence.",
  },
  {
    key: "cacheMisses",
    label: "Cache misses",
    detail: "First observations with no stored request projection.",
  },
  {
    key: "staleHits",
    label: "Stale hits",
    detail: "Clearly labelled stored values returned while refresh was queued.",
  },
  {
    key: "refreshes",
    label: "Refreshes",
    detail: "Forced or stale-while-refresh provider requests.",
  },
  {
    key: "throttles",
    label: "Throttles",
    detail: "Requests delayed by provider limits or configured budgets.",
  },
];

function dateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DataProvidersWorkspace() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const response = await fetch("/api/providers/usage", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("USAGE_UNAVAILABLE");
      setUsage((await response.json()) as UsageSummary);
    } catch {
      setError("Provider usage is temporarily unavailable.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="content-page data-providers-page">
      <PageHeader
        title="Data & Providers"
        description="See how stored research evidence reduces live calls without exposing requests, payloads, or credentials."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Settings" },
          { label: "Data & Providers" },
        ]}
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            Refresh usage
          </Button>
        }
      />
      {error ? (
        <Alert tone="danger" title="Usage unavailable">
          {error}
        </Alert>
      ) : null}
      {!usage ? (
        <div
          className="provider-usage-grid"
          aria-label="Loading provider usage"
        >
          {metrics.map((metric) => (
            <Skeleton key={metric.key} className="provider-usage-skeleton" />
          ))}
        </div>
      ) : (
        <>
          <Card className="provider-usage-context">
            <div>
              <Badge tone="info">Last 30 days</Badge>
              <h2>Research memory</h2>
              <p>
                Counts begin {dateTime(usage.since)}. A cache hit means the
                exact organization, marketplace, capability, operation, and
                normalized request matched stored evidence that remained fresh.
              </p>
            </div>
            <div className="badge-stack" aria-label="Observed providers">
              {usage.providers.length ? (
                usage.providers.map((provider) => (
                  <Badge key={provider} tone="neutral">
                    {provider}
                  </Badge>
                ))
              ) : (
                <Badge tone="neutral">No provider activity yet</Badge>
              )}
            </div>
          </Card>
          <div className="provider-usage-grid">
            {metrics.map((metric) => (
              <Card key={metric.key} className="provider-usage-metric">
                <span>{metric.label}</span>
                <strong>{usage[metric.key].toLocaleString()}</strong>
                <p>{metric.detail}</p>
              </Card>
            ))}
          </div>
          <div className="provider-usage-detail-grid">
            <Card>
              <h2>Estimated provider usage</h2>
              {usage.estimatedUsage.length ? (
                <ul className="provider-usage-list">
                  {usage.estimatedUsage.map((item) => (
                    <li key={item.unit}>
                      <span>{item.unit.toLowerCase()}</span>
                      <strong>{item.value}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No provider credit/token estimate has been configured.</p>
              )}
            </Card>
            <Card>
              <h2>Estimated provider cost</h2>
              {usage.estimatedCost.length ? (
                <ul className="provider-usage-list">
                  {usage.estimatedCost.map((item) => (
                    <li key={item.currency}>
                      <span>{item.currency}</span>
                      <strong>{item.value}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No monetary rate estimate is configured. RizPoint will not
                  invent one.
                </p>
              )}
            </Card>
          </div>
          <Alert tone="info" title="What these numbers mean">
            Page navigation reads PostgreSQL only. Live calls happen in worker
            jobs created by explicit research or refresh actions. Mock activity
            is recorded separately and is never counted as live provider use.
          </Alert>
        </>
      )}
    </main>
  );
}
