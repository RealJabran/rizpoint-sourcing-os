"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import { ScanSummaryTable } from "@/src/components/scan-summary-table";
import type { ScanSummary } from "@/src/components/dashboard-state";
import { Alert, ButtonLink, Card, Skeleton } from "@/src/components/ui";
import { abortExpectedRequest, requestWasAborted } from "@/src/abort";

type ScanListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; scans: ScanSummary[] };

export default function ScansPage() {
  const [state, setState] = useState<ScanListState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/scans?limit=50", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("SCAN_LIST_UNAVAILABLE");
        const scans = (await response.json()) as ScanSummary[];
        if (active) setState({ kind: "ready", scans });
      } catch (error) {
        if (!active || requestWasAborted(error, controller.signal)) return;
        setState({ kind: "error" });
      }
    })();
    return () => {
      active = false;
      abortExpectedRequest(controller);
    };
  }, []);

  return (
    <main className="content-page">
      <PageHeader
        title="Catalog scans"
        description="Persisted catalog work, ordered by most recent activity."
        actions={<ButtonLink href="/uploads">New scan</ButtonLink>}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Catalog scans" },
        ]}
      />
      {state.kind === "loading" ? (
        <Card>
          <Skeleton className="table-skeleton" />
        </Card>
      ) : null}
      {state.kind === "error" ? (
        <Alert tone="danger" title="Scan list is unavailable">
          Refresh the page to retry. Existing scan data is unchanged.
        </Alert>
      ) : null}
      {state.kind === "ready" && state.scans.length ? (
        <Card>
          <ScanSummaryTable scans={state.scans} />
        </Card>
      ) : null}
      {state.kind === "ready" && !state.scans.length ? (
        <Card className="empty-state">
          <span className="empty-state__eyebrow">No catalog scans yet</span>
          <h2>Inspect your first supplier catalog.</h2>
          <p>
            Start a scan to upload, inspect, and map a catalog before matching
            or profitability work begins.
          </p>
          <ButtonLink href="/uploads">New scan</ButtonLink>
        </Card>
      ) : null}
    </main>
  );
}
