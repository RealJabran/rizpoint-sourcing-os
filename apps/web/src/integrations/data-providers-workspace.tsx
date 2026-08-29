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

type RetentionSummary = {
  policy: {
    rizpointMaximumCalendarMonths: number;
    amazonEventDeletionDeadlineDays: number;
    legalHoldsSupported: boolean;
    shorterContractualRetentionWins: boolean;
  };
  oldestObservationAt: string | null;
  nearingExpiryCount: number;
  deletedRecords: number;
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    failureCode: string | null;
  } | null;
  nextScheduledRunAt: string;
  failedDeletionJobs: number;
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
  const [retention, setRetention] = useState<RetentionSummary | null>(null);
  const [retentionAccess, setRetentionAccess] = useState<
    "loading" | "allowed" | "denied"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionReason, setDeletionReason] = useState<
    "OPERATOR_POLICY" | "AMAZON_NOTICE" | "AUTHORIZATION_REVOKED"
  >("OPERATOR_POLICY");
  const [deletionStatus, setDeletionStatus] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const response = await fetch("/api/providers/usage", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("USAGE_UNAVAILABLE");
      setUsage((await response.json()) as UsageSummary);
      const retentionResponse = await fetch("/api/providers/retention", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (
        retentionResponse.status === 401 ||
        retentionResponse.status === 403
      ) {
        setRetentionAccess("denied");
      } else if (retentionResponse.ok) {
        setRetention((await retentionResponse.json()) as RetentionSummary);
        setRetentionAccess("allowed");
      } else {
        throw new Error("RETENTION_UNAVAILABLE");
      }
    } catch {
      setError("Provider usage is temporarily unavailable.");
    }
  }

  async function requestAmazonDeletion() {
    if (deletionConfirmation !== "DELETE AMAZON INFORMATION") return;
    setDeletionStatus("Submitting secure deletion request…");
    const response = await fetch("/api/providers/retention", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: deletionReason,
        confirmation: deletionConfirmation,
        idempotencyKey: `amazon-deletion-${crypto.randomUUID()}`,
      }),
    });
    if (!response.ok) {
      setDeletionStatus("Deletion request could not be created.");
      return;
    }
    const result = (await response.json()) as { deadlineAt: string };
    setDeletionConfirmation("");
    setDeletionStatus(
      `Amazon access is in safe state. Deletion deadline: ${dateTime(result.deadlineAt)}.`,
    );
    await load();
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
          {retentionAccess === "allowed" && retention ? (
            <section
              className="provider-retention"
              aria-labelledby="retention-heading"
            >
              <Card className="provider-usage-context">
                <div>
                  <Badge tone="success">Enforced lifecycle</Badge>
                  <h2 id="retention-heading">Amazon Information retention</h2>
                  <p>
                    RizPoint applies a maximum of{" "}
                    {retention.policy.rizpointMaximumCalendarMonths} calendar
                    months to ordinary Amazon SP-API observations. A shorter
                    contractual policy always wins. Applicable Amazon deletion
                    events use a{" "}
                    {retention.policy.amazonEventDeletionDeadlineDays}-day
                    deadline.
                  </p>
                </div>
                <Badge
                  tone={retention.failedDeletionJobs ? "danger" : "success"}
                >
                  {retention.failedDeletionJobs
                    ? `${retention.failedDeletionJobs} deletion job failures`
                    : "No failed deletion jobs"}
                </Badge>
              </Card>
              <div className="provider-usage-grid">
                <Card className="provider-usage-metric">
                  <span>Oldest Amazon observation</span>
                  <strong className="provider-retention-date">
                    {retention.oldestObservationAt
                      ? dateTime(retention.oldestObservationAt)
                      : "None stored"}
                  </strong>
                  <p>Oldest tenant-scoped source observation still retained.</p>
                </Card>
                <Card className="provider-usage-metric">
                  <span>Nearing expiry</span>
                  <strong>
                    {retention.nearingExpiryCount.toLocaleString()}
                  </strong>
                  <p>
                    Amazon-source records reaching effective expiry in 30 days.
                  </p>
                </Card>
                <Card className="provider-usage-metric">
                  <span>Deleted Amazon records</span>
                  <strong>{retention.deletedRecords.toLocaleString()}</strong>
                  <p>Metadata count only; deleted values are not retained.</p>
                </Card>
              </div>
              <div className="provider-usage-detail-grid">
                <Card>
                  <h2>Retention worker</h2>
                  <ul className="provider-usage-list">
                    <li>
                      <span>Last run</span>
                      <strong>
                        {retention.lastRun
                          ? `${retention.lastRun.status} · ${dateTime(retention.lastRun.startedAt)}`
                          : "No run recorded"}
                      </strong>
                    </li>
                    <li>
                      <span>Next scheduled check</span>
                      <strong>{dateTime(retention.nextScheduledRunAt)}</strong>
                    </li>
                    <li>
                      <span>Legal holds</span>
                      <strong>Not supported</strong>
                    </li>
                  </ul>
                </Card>
                <Card className="provider-deletion-card">
                  <h2>Delete organization Amazon Information</h2>
                  <p>
                    This immediately revokes the local Amazon connection, stops
                    Amazon provider work, and queues bounded deletion. Supplier
                    files and security audit logs are not deleted.
                  </p>
                  <label>
                    Reason
                    <select
                      value={deletionReason}
                      onChange={(event) =>
                        setDeletionReason(
                          event.target.value as typeof deletionReason,
                        )
                      }
                    >
                      <option value="OPERATOR_POLICY">Operator request</option>
                      <option value="AMAZON_NOTICE">Amazon notice</option>
                      <option value="AUTHORIZATION_REVOKED">
                        Amazon authorization revoked
                      </option>
                    </select>
                  </label>
                  <label>
                    Type DELETE AMAZON INFORMATION to confirm
                    <input
                      value={deletionConfirmation}
                      onChange={(event) =>
                        setDeletionConfirmation(event.target.value)
                      }
                      autoComplete="off"
                    />
                  </label>
                  <Button
                    variant="danger"
                    disabled={
                      deletionConfirmation !== "DELETE AMAZON INFORMATION"
                    }
                    onClick={() => void requestAmazonDeletion()}
                  >
                    Revoke and queue deletion
                  </Button>
                  {deletionStatus ? (
                    <p role="status">{deletionStatus}</p>
                  ) : null}
                </Card>
              </div>
            </section>
          ) : retentionAccess === "denied" ? (
            <Alert tone="info" title="Retention administration">
              Amazon Information retention is enforced automatically. Only an
              owner or administrator can view deletion operations.
            </Alert>
          ) : null}
        </>
      )}
    </main>
  );
}
