"use client";

import { useState } from "react";

type ScanJob = {
  id: string;
  status: string;
  attemptCount: number;
  mockResult: unknown;
};

export default function MockScansPage() {
  const [job, setJob] = useState<ScanJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function scheduleRefresh(id: string): void {
    window.setTimeout(() => {
      void refresh(id).catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unexpected polling error.",
        );
      });
    }, 500);
  }

  async function refresh(id: string): Promise<void> {
    const response = await fetch(`/api/mock-scans/${id}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Unable to read mock scan status.");
    const nextJob = (await response.json()) as ScanJob;
    setJob(nextJob);
    if (
      nextJob.status === "QUEUED" ||
      nextJob.status === "RUNNING" ||
      nextJob.status === "FAILED_RETRYABLE"
    ) {
      scheduleRefresh(id);
    }
  }

  async function start(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mock-scans", { method: "POST" });
      if (!response.ok) throw new Error("Unable to create mock scan.");
      const created = (await response.json()) as ScanJob;
      setJob(created);
      await refresh(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Mock scan vertical slice</h1>
      <p>
        Creates a synthetic job for the Phase 0 organization and polls
        PostgreSQL-backed status.
      </p>
      <button type="button" disabled={loading} onClick={() => void start()}>
        {loading ? "Starting…" : "Start mock scan"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {job ? <pre>{JSON.stringify(job, null, 2)}</pre> : null}
    </main>
  );
}
