"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { ProductPicker } from "@/src/components/entity-pickers";

type Relationship = {
  catalogProductId: string;
  asin: string | null;
  title: string;
  relationshipType: "SHARED_KEYWORD" | "SHARED_MARKET";
  source: "DERIVED";
  strength: number;
  confidence: "LOW" | "MEDIUM";
};

export function ProductRelationships() {
  const [productId, setProductId] = useState("");
  const [rows, setRows] = useState<Relationship[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function expand() {
    setError(null);
    const response = await fetch(
      `/api/product-relationships?productId=${encodeURIComponent(productId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Unable to load relationships");
      return;
    }
    setRows(body.rows);
  }
  return (
    <main className="content-page">
      <PageHeader
        title="Product Relationship Graph"
        description="Evidence-based product neighborhoods with an accessible table alternative."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Product relationships" },
        ]}
      />
      <Alert tone="info" title="Derived similarity, not customer behavior">
        This workspace derives connections only from shared licensed keyword
        observations and shared saved markets. It does not label them as Amazon
        “also viewed” or “frequently bought together.”
      </Alert>
      <Card>
        <label htmlFor="product-id">Starting product</label>
        <div className="inline-actions">
          <ProductPicker
            id="product-id"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          />
          <Button type="button" onClick={expand} disabled={!productId.trim()}>
            Expand node
          </Button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </Card>
      <Card>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Related product</th>
                  <th>Relationship</th>
                  <th>Source</th>
                  <th>Strength</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.catalogProductId}-${row.relationshipType}`}>
                    <td>
                      {row.asin ?? row.catalogProductId}
                      <br />
                      <small>{row.title}</small>
                    </td>
                    <td>{row.relationshipType.replace("_", " ")}</td>
                    <td>
                      <Badge tone="info">DERIVED</Badge>
                    </td>
                    <td>
                      {row.strength} shared{" "}
                      {row.relationshipType === "SHARED_MARKET"
                        ? "market(s)"
                        : "keyword(s)"}
                    </td>
                    <td>{row.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            Enter a product ID to inspect its authorized, derived neighborhood.
            No licensed behavioral relationship provider is configured.
          </p>
        )}
      </Card>
    </main>
  );
}
