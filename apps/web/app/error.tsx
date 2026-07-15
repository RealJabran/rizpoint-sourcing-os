"use client";

import { useEffect } from "react";
import { Button, ButtonLink, Card } from "@/src/components/ui";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route_error", { digest: error.digest });
  }, [error.digest]);
  return (
    <main className="content-page error-page">
      <Card>
        <p className="empty-state__eyebrow">Something needs attention</p>
        <h1>This page could not be loaded.</h1>
        <p>
          Your persisted sourcing data has not been changed. You can retry the
          page or return to the dashboard.
        </p>
        <div className="page-actions">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary">
            Dashboard
          </ButtonLink>
        </div>
      </Card>
    </main>
  );
}
