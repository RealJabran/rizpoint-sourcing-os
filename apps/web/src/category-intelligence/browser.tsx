"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  TextInput,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Category = {
  categoryReference: string;
  categoryName: string;
  marketplaceId: string | null;
  trackedProductCount: number;
  universe: string;
};

export function CategoryBrowser() {
  const { notify } = useToast();
  const [marketplaceId, setMarketplaceId] = useState("");
  const [rows, setRows] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (marketplaceId.trim()) params.set("marketplaceId", marketplaceId.trim());
    const response = await fetch(`/api/category-intelligence?${params}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok)
      return notify(payload?.error ?? "Could not load categories", "danger");
    setRows(payload.rows);
    setTotal(payload.total);
  }, [marketplaceId, notify]);
  useEffect(() => {
    // Defer the client fetch so this effect synchronizes external data rather
    // than forcing a synchronous render cascade.
    void Promise.resolve().then(load);
  }, [load]);
  return (
    <main className="content-page category-intelligence">
      <PageHeader
        title="Category Intelligence"
        description="Category research over the products your organization has actually tracked, imported, watched, or added to a market."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Category Intelligence" },
        ]}
      />
      <Alert tone="info" title="Coverage before conclusions">
        This browser is not a global Amazon category tree. Category labels and
        counts come from the currently tracked evidence universe;
        provider-supplied hierarchy and market-size estimates are not connected.
      </Alert>
      <Card className="explorer-controls">
        <div className="explorer-filter-grid">
          <TextInput
            aria-label="Marketplace"
            placeholder="Marketplace ID (optional)"
            value={marketplaceId}
            onChange={(event) => setMarketplaceId(event.target.value)}
          />
          <Button type="button" onClick={() => void load()} loading={loading}>
            Refresh categories
          </Button>
        </div>
      </Card>
      <section className="category-summary" aria-live="polite">
        <strong>{total}</strong> category nodes in the tracked universe
      </section>
      {loading ? (
        <Card>Loading category nodes…</Card>
      ) : rows.length ? (
        <div
          className="category-tree"
          role="list"
          aria-label="Tracked category tree"
        >
          {rows.map((row) => {
            const params = new URLSearchParams();
            if (row.marketplaceId)
              params.set("marketplaceId", row.marketplaceId);
            return (
              <Link
                key={`${row.marketplaceId}:${row.categoryReference}`}
                role="listitem"
                className="rp-card category-node"
                href={`/category-intelligence/${encodeURIComponent(row.categoryReference)}${params.size ? `?${params}` : ""}`}
              >
                <div>
                  <span className="category-node__branch" aria-hidden="true">
                    └
                  </span>
                  <strong>{row.categoryName}</strong>
                  <p>{row.universe}</p>
                </div>
                <div>
                  <Badge tone="info">
                    {row.trackedProductCount} tracked products
                  </Badge>
                  {row.marketplaceId ? (
                    <small>{row.marketplaceId}</small>
                  ) : (
                    <small>Marketplace not supplied</small>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card className="empty-state">
          <h2>No category evidence yet</h2>
          <p>
            Import matched products, add products to a project, create a watch,
            or refresh history. Category nodes appear only when a product is in
            your organization’s evidence universe.
          </p>
          <Link
            className="rp-button rp-button--primary rp-button--md"
            href="/product-explorer"
          >
            Open Product Explorer
          </Link>
        </Card>
      )}
    </main>
  );
}
