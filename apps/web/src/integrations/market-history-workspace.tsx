"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import { Alert, Badge, ButtonLink, Card, Skeleton } from "@/src/components/ui";

type HistoryStatus = {
  provider: string;
  mode: "LIVE" | "MOCK";
  status: string;
  configured: boolean;
  checkedAt: string;
  dataOrigin: string;
  message?: string;
  capabilities: Array<{
    state: string;
    checkedAt: string;
    completeness: string;
  }>;
};

export function MarketHistoryIntegrationWorkspace() {
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/providers/market-history", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("STATUS_FAILED");
        return response.json() as Promise<HistoryStatus>;
      })
      .then((payload) => {
        if (!cancelled) setStatus(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const connected = status?.mode === "LIVE" && status.configured;
  return (
    <main className="content-page history-integration-page">
      <PageHeader
        title="Market history"
        description="Optional licensed price, rank, offer, rating, and review history. Amazon SP-API is never used as a substitute."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Settings", href: "/settings/integrations" },
          { label: "Market history" },
        ]}
        actions={
          <ButtonLink href="/product-research" variant="secondary">
            Research a product
          </ButtonLink>
        }
      />
      {failed ? (
        <Alert tone="danger" title="Status unavailable">
          Provider status could not be read. No historical data will be
          fabricated.
        </Alert>
      ) : !status ? (
        <Card>
          <Skeleton className="research-job-skeleton" />
        </Card>
      ) : (
        <>
          <Card className="integration-directory-card">
            <div className="amazon-provider-mark" aria-hidden="true">
              K
            </div>
            <div>
              <div className="badge-stack">
                <Badge tone={connected ? "success" : "warning"}>
                  {connected ? "Configured" : "Provider required"}
                </Badge>
                <Badge tone="neutral">Licensed history</Badge>
              </div>
              <h2>Keepa market history</h2>
              <p>
                {connected
                  ? "A tenant-scoped encrypted credential is present. Refresh jobs will use entitlement, token-budget, cache, lease, and retention controls."
                  : "Live history is unavailable until a licensed Keepa plan and server-side encrypted credential are configured."}
              </p>
            </div>
          </Card>
          <div className="research-entry-grid">
            <Card>
              <h2>Current capability</h2>
              <dl className="definition-grid">
                <div>
                  <dt>State</dt>
                  <dd>{status.status.replaceAll("_", " ").toLowerCase()}</dd>
                </div>
                <div>
                  <dt>Data origin</dt>
                  <dd>
                    {status.dataOrigin.replaceAll("_", " ").toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt>Checked</dt>
                  <dd>{new Date(status.checkedAt).toLocaleString()}</dd>
                </div>
              </dl>
              {status.message ? <p>{status.message}</p> : null}
            </Card>
            <Card>
              <h2>Secure activation checklist</h2>
              <ol>
                <li>
                  Obtain a licensed Keepa API plan and review retention/export
                  rights.
                </li>
                <li>
                  Set the worker-only credential encryption key and live
                  provider mode.
                </li>
                <li>
                  Import the API key as the tenant-scoped encrypted{" "}
                  <code>keepa / api_key</code> credential.
                </li>
                <li>
                  Configure the MARKET_HISTORY token budget and per-ASIN token
                  estimate.
                </li>
                <li>
                  Run an explicit product History refresh; page navigation makes
                  no provider call.
                </li>
              </ol>
              <p>
                Secrets must never be pasted into this browser. See the private
                deployment procedure in <code>docs/SECURITY.md</code>.
              </p>
            </Card>
          </div>
          <Alert tone="info" title="History is optional">
            Product research remains useful with catalog, offer, fee, and
            restriction evidence when history is unavailable. Missing history
            stays missing.
          </Alert>
        </>
      )}
    </main>
  );
}
