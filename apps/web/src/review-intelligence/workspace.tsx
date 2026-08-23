"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { ProductPicker } from "@/src/components/entity-pickers";

type Theme = {
  id: string;
  kind: string;
  label: string;
  reviewCount: number;
  averageRating: string | null;
  evidenceReviewIds: string[];
  methodVersion: string;
};
type Review = {
  id: string;
  rating: number;
  bodyRedacted: string;
  source: string;
  observedAt: string;
};

export function ReviewIntelligence() {
  const [productId, setProductId] = useState("");
  const [themes, setThemes] = useState<Theme[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setError(null);
    const response = await fetch(
      `/api/review-intelligence?productId=${encodeURIComponent(productId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Unable to load review evidence");
      return;
    }
    setThemes(body.themes);
    setReviews(body.reviews);
  }
  async function rebuild() {
    const response = await fetch("/api/review-intelligence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "REBUILD_THEMES",
        catalogProductId: productId,
      }),
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Unable to rebuild themes");
      return;
    }
    await load();
  }
  return (
    <main className="content-page">
      <PageHeader
        title="Review Intelligence"
        description="Authorized review evidence, themes, and inspectable examples."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Review intelligence" },
        ]}
      />
      <Alert tone="info" title="Lawful sources and evidence required">
        Only licensed provider records, user imports, or other authorized
        sources may be ingested. Email, phone, and order/invoice references are
        redacted before storage. Theme labels are deterministic Rules V1
        summaries, not unsupported AI claims.
      </Alert>
      <Card>
        <label htmlFor="review-product-id">Researched product</label>
        <div className="inline-actions">
          <ProductPicker
            id="review-product-id"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          />
          <Button type="button" onClick={load} disabled={!productId.trim()}>
            Load evidence
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={rebuild}
            disabled={!productId.trim()}
          >
            Rebuild themes
          </Button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </Card>
      <Card>
        <h2>What customers want improved</h2>
        {themes.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Theme</th>
                  <th>Evidence count</th>
                  <th>Average rating</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {themes.map((theme) => (
                  <tr key={theme.id}>
                    <td>
                      <Badge
                        tone={theme.kind === "PRAISE" ? "success" : "warning"}
                      >
                        {theme.kind}
                      </Badge>{" "}
                      {theme.label}
                    </td>
                    <td>{theme.reviewCount} linked review(s)</td>
                    <td>{theme.averageRating ?? "Unavailable"}</td>
                    <td>{theme.methodVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No review themes yet. Import authorized review records, then rebuild
            deterministic themes.
          </p>
        )}
      </Card>
      <Card>
        <h2>Source examples</h2>
        {reviews.length ? (
          <ul>
            {reviews.map((review) => (
              <li key={review.id}>
                <strong>
                  {review.rating}/5 · {review.source}
                </strong>{" "}
                — {review.bodyRedacted} <small>({review.id})</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No redacted source examples are available for this product.</p>
        )}
      </Card>
    </main>
  );
}
