"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Event = {
  id: string;
  status: string;
  observedAt: string;
  payload: Record<string, unknown> | null;
  alertRule: { metricKey: string; operator: string; threshold: string | null };
};
export default function AlertsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    fetch("/api/alerts")
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => setError("ALERTS_UNAVAILABLE"));
  useEffect(() => {
    void load();
  }, []);
  const ack = async (id: string) => {
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "acknowledge", id }),
    });
    load();
  };
  return (
    <div className="page-stack">
      <PageHeader
        title="Alerts & notifications"
        description="Observed change events only; missing provider data is never treated as zero."
      />
      {error ? (
        <Alert tone="danger" title="Alerts error">
          {error}
        </Alert>
      ) : null}
      <Card>
        <h2>In-app notification center</h2>
        {events.length ? (
          events.map((e) => (
            <article className="inset-card" key={e.id}>
              <strong>{e.alertRule.metricKey}</strong> · {e.status}
              <p>
                Observed {new Date(e.observedAt).toLocaleString()} ·{" "}
                {JSON.stringify(e.payload)}
              </p>
              {e.status === "OPEN" ? (
                <Button variant="secondary" onClick={() => ack(e.id)}>
                  Acknowledge
                </Button>
              ) : null}
            </article>
          ))
        ) : (
          <p>
            No alert events yet. Provider or observed-history data must exist
            before an alert can trigger.
          </p>
        )}
      </Card>
    </div>
  );
}
