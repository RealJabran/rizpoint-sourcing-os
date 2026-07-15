"use client";
import { useEffect, useRef, useState } from "react";
type PurchaseOrderLine = {
  id: string;
  requestedUnits: number;
  orderedCases: number;
  casePack: number;
  orderedSellableUnits: number;
  projectedProfitTotal: string;
  supplierRow: {
    normalizedOffer: {
      description: string | null;
      itemNumber: string | null;
    } | null;
  };
};
type ExportJob = {
  id: string;
  kind: string;
  format: string;
  status: string;
  expiresAt: string | null;
  failureCode: string | null;
};
type PurchaseOrder = {
  revision: number;
  status: string;
  supplierSubtotal: string;
  projectedProfitTotal: string;
  currency: string;
  budgetAmount: string | null;
  lines: PurchaseOrderLine[];
  exportJobs: ExportJob[];
};
export default function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ purchaseOrderId: string }>;
}) {
  const [id, setId] = useState("");
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const pendingAction = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const load = async (orderId: string) => {
    const response = await fetch(`/api/purchase-orders/${orderId}`);
    if (response.ok) setOrder(await response.json());
    else setError("Purchase order not found.");
  };
  useEffect(() => {
    void params.then(({ purchaseOrderId }) => {
      setId(purchaseOrderId);
      return load(purchaseOrderId);
    });
  }, [params]);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);
  const validate = async () => {
    if (!order || pendingAction.current) return;
    pendingAction.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/purchase-orders/${id}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: order.revision,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok)
        setError("Validation failed. Review missing data and stale evidence.");
      else await load(id);
    } finally {
      pendingAction.current = false;
      setSubmitting(false);
    }
  };
  const exportFile = async (format: string, kind = "PURCHASE_ORDER") => {
    if (pendingAction.current) return;
    pendingAction.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/purchase-orders/${id}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          format,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) setError("Export could not be queued.");
      else await load(id);
    } finally {
      pendingAction.current = false;
      setSubmitting(false);
    }
  };
  if (!order)
    return (
      <main>
        {error ? <p role="alert">{error}</p> : null}
        <p role="status">Loading purchase order…</p>
      </main>
    );
  return (
    <main>
      <h1>Purchase order</h1>
      {error ? <p role="alert">{error}</p> : null}
      <p>Status: {order.status}</p>
      <p>
        Supplier total: {order.supplierSubtotal} {order.currency}; budget:{" "}
        {order.budgetAmount ?? "Not set"}
      </p>
      <p>
        Projected profit: {order.projectedProfitTotal} {order.currency}
      </p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Requested</th>
            <th>Cases</th>
            <th>Ordered units</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.supplierRow.normalizedOffer?.description ??
                  line.supplierRow.normalizedOffer?.itemNumber}
              </td>
              <td>{line.requestedUnits}</td>
              <td>
                {line.orderedCases} × {line.casePack}
              </td>
              <td>{line.orderedSellableUnits}</td>
              <td>{line.projectedProfitTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.status === "DRAFT" ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void validate()}
        >
          Validate PO
        </button>
      ) : (
        <>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void exportFile("CSV")}
          >
            Queue CSV
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void exportFile("XLSX")}
          >
            Queue XLSX
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void exportFile("XLSX", "AUDIT_REPORT")}
          >
            Queue audit report
          </button>
        </>
      )}
      <h2>Exports</h2>
      {order.exportJobs.length ? (
        <ul>
          {order.exportJobs.map((job) => (
            <li key={job.id}>
              {job.kind} {job.format}: {job.status}{" "}
              {job.status === "COMPLETED" &&
              job.expiresAt &&
              now !== null &&
              new Date(job.expiresAt).getTime() > now ? (
                <a href={`/api/exports/${job.id}?download=1`}>Download</a>
              ) : job.status === "COMPLETED" ? (
                <span>Download expired. Queue a new export.</span>
              ) : job.failureCode ? (
                <span>
                  Failed: {job.failureCode}. Queue a new export to retry.
                </span>
              ) : (
                <span>Preparing private download…</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No exports requested.</p>
      )}
    </main>
  );
}
