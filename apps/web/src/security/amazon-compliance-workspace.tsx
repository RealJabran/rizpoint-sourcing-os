"use client";

import {
  CheckCircle2,
  CircleAlert,
  FileSignature,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Skeleton,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Status = {
  deployment: null | {
    deploymentId: string;
    observedAt: string;
    overallStatus: string;
    releaseDigest: string;
    signerFingerprint: string;
  };
  controls: Array<{
    id: string;
    label: string;
    status: string;
    detail: string;
  }>;
  governance: Array<{
    label: string;
    status: string;
    lastPerformedAt: string | null;
    nextDueAt: string | null;
  }>;
};

function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not recorded";
}

export function AmazonComplianceWorkspace() {
  const { notify } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/security/amazon-compliance", {
      cache: "no-store",
    });
    if (!response.ok) {
      setError(
        response.status === 403
          ? "Only the organization owner can view deployment evidence."
          : "Amazon compliance status is unavailable.",
      );
      return;
    }
    setStatus((await response.json()) as Status);
    setError(null);
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function importEvidence(formData: FormData) {
    const reportFile = formData.get("report");
    const signatureFile = formData.get("signature");
    if (!(reportFile instanceof File) || !(signatureFile instanceof File))
      return;
    setBusy(true);
    try {
      const response = await fetch("/api/security/amazon-compliance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportText: await reportFile.text(),
          signatureBase64: await signatureFile.text(),
        }),
      });
      if (!response.ok) throw new Error("Signed report was not accepted");
      notify("Verified deployment evidence imported", "success");
      await load();
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "Import failed",
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status && !error)
    return (
      <main className="security-workspace">
        <Skeleton className="security-page-skeleton" />
      </main>
    );
  return (
    <main className="security-workspace">
      <PageHeader
        kicker="Deployment evidence"
        title="Amazon Compliance"
        description="A tenant-scoped view of signed, live production checks. Configuration files and self-declared flags never appear as verified evidence."
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" /> Refresh
          </Button>
        }
      />
      {error ? (
        <Alert title="Owner access required" tone="warning">
          {error}
        </Alert>
      ) : null}
      {status ? (
        <>
          <Card className="security-overview-card">
            <div className="security-section-heading">
              <div>
                <p className="eyebrow">Production deployment</p>
                <h2>
                  {status.deployment
                    ? "Signed evidence verified"
                    : "Deployment evidence missing"}
                </h2>
                <p>
                  {status.deployment
                    ? `Observed ${date(status.deployment.observedAt)} · report ${status.deployment.releaseDigest}`
                    : "Deploy and run the strict verifier on the real host before importing evidence."}
                </p>
              </div>
              <Badge tone={status.deployment ? "success" : "warning"}>
                {status.deployment ? "VERIFIED" : "EXTERNAL ACTION REQUIRED"}
              </Badge>
            </div>
          </Card>
          <section
            className="security-grid"
            aria-label="Amazon security controls"
          >
            {status.controls.map((control) => {
              const verified = control.status === "VERIFIED";
              return (
                <Card key={control.id} className="security-control-card">
                  <div
                    className="security-control-icon"
                    data-tone={verified ? "success" : "warning"}
                  >
                    {verified ? (
                      <CheckCircle2 aria-hidden="true" />
                    ) : (
                      <CircleAlert aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <h3>{control.label}</h3>
                    <p>{control.detail}</p>
                  </div>
                  <Badge tone={verified ? "success" : "warning"}>
                    {verified ? "Verified" : "Missing"}
                  </Badge>
                </Card>
              );
            })}
          </section>
          <Card>
            <div className="security-section-heading">
              <div>
                <p className="eyebrow">Operational cadence</p>
                <h2>Governance evidence</h2>
              </div>
            </div>
            <div className="security-control-list">
              {status.governance.map((item) => (
                <div key={item.label} className="security-control-row">
                  <div>
                    <strong>{item.label}</strong>
                    <span>
                      {date(item.lastPerformedAt)} · next due{" "}
                      {date(item.nextDueAt)}
                    </span>
                  </div>
                  <Badge
                    tone={item.status === "CURRENT" ? "success" : "warning"}
                  >
                    {item.status === "CURRENT"
                      ? "Current"
                      : "Overdue or missing"}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <form
              action={(formData) => void importEvidence(formData)}
              className="security-evidence-form"
            >
              <div>
                <p className="eyebrow">Owner action</p>
                <h2>Import signed verifier output</h2>
                <p>
                  Choose the sanitized JSON report and detached signature
                  produced outside Git. Files are verified server-side and
                  secrets are never accepted.
                </p>
              </div>
              <label>
                Deployment report
                <input
                  name="report"
                  type="file"
                  accept="application/json,.json"
                  required
                />
              </label>
              <label>
                Detached signature
                <input
                  name="signature"
                  type="file"
                  accept="text/plain,.sig"
                  required
                />
              </label>
              <Button type="submit" disabled={busy}>
                <FileSignature aria-hidden="true" />{" "}
                {busy ? "Verifying…" : "Verify and import"}
              </Button>
            </form>
          </Card>
        </>
      ) : null}
    </main>
  );
}
