"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import { ButtonLink, Card } from "@/src/components/ui";

type PurchaseOrder = {
  id: string;
  status: string;
  currency: string;
  supplierSubtotal: string;
  projectedProfitTotal: string;
  createdAt: string;
  supplier: { name: string; code: string };
  shippingRoute: { name: string };
  _count: { lines: number; exportJobs: number };
};

export default function PurchaseOrdersLandingPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/purchase-orders", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("PURCHASE_ORDERS_UNAVAILABLE");
        return (await response.json()) as PurchaseOrder[];
      })
      .then(setOrders)
      .catch(() => setError("Unable to load purchase orders. Retry shortly."));
  }, []);

  return (
    <main className="content-page">
      <PageHeader
        title="Purchase orders"
        description="Validated supplier, route, currency, and scenario snapshots."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Purchase orders" },
        ]}
      />
      {error ? <p role="alert">{error}</p> : null}
      {orders.length ? (
        <Card>
          <ul className="workflow-list">
            {orders.map((order) => (
              <li key={order.id}>
                <a href={`/purchase-orders/${order.id}`}>
                  {order.supplier.code} — {order.shippingRoute.name}
                </a>
                <span>
                  {order.status} · {order._count.lines} lines · {order.currency}{" "}
                  {order.supplierSubtotal} supplier total · {order.currency}{" "}
                  {order.projectedProfitTotal} projected profit
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="empty-state">
          <span className="empty-state__eyebrow">
            Available from a shortlist
          </span>
          <h2>Start with verified sourcing decisions.</h2>
          <p>
            Create a purchase order only from compatible shortlist items with a
            current route, currency, and verified PackGuard result.
          </p>
          <ButtonLink href="/shortlists">Open shortlists</ButtonLink>
        </Card>
      )}
    </main>
  );
}
