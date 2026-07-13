"use client";
import { useEffect, useState } from "react";
export default function ShortlistDetail({
  params,
}: {
  params: Promise<{ shortlistId: string }>;
}) {
  const [id, setId] = useState("");
  const [data, setData] = useState<{
    name: string;
    items: Array<{
      id: string;
      status: string;
      ownerReference: string | null;
      profitResult: {
        recommendation: string | null;
        supplierRow: { normalizedOffer: { description: string | null } | null };
      };
    }>;
  } | null>(null);
  const [error, setError] = useState("");
  const [requestedUnits, setRequestedUnits] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    void params.then(async ({ shortlistId }) => {
      setId(shortlistId);
      const response = await fetch(`/api/shortlists/${shortlistId}`);
      if (response.ok) setData(await response.json());
      else setError("Shortlist not found.");
    });
  }, [params]);
  const transition = async (itemId: string, status: string) => {
    const response = await fetch(`/api/shortlists/${id}/items`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemIds: [itemId],
        status,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) setError("Could not update item status.");
    else {
      const refreshed = await fetch(`/api/shortlists/${id}`);
      setData(await refreshed.json());
    }
  };
  const createPurchaseOrder = async () => {
    if (!data) return;
    const response = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shortlistId: id,
        itemIds: data.items.map((item) => item.id),
        scenarioType: "CURRENT",
        idempotencyKey: crypto.randomUUID(),
        quantities: Object.fromEntries(
          data.items.map((item) => [
            item.id,
            {
              requestedUnits: Number(requestedUnits[item.id] ?? "20"),
              minimumOrderCases: 1,
              orderMultipleCases: 1,
            },
          ]),
        ),
      }),
    });
    if (!response.ok) {
      setError(
        "Could not build a PO. Items must share a verified supplier and route.",
      );
      return;
    }
    const order = (await response.json()) as { id: string };
    window.location.assign(`/purchase-orders/${order.id}`);
  };
  const exportShortlist = async (format: "CSV" | "XLSX") => {
    const response = await fetch(`/api/shortlists/${id}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format, idempotencyKey: crypto.randomUUID() }),
    });
    if (!response.ok) setError("Could not queue shortlist export.");
  };
  if (error)
    return (
      <main>
        <p role="alert">{error}</p>
      </main>
    );
  if (!data)
    return (
      <main>
        <p role="status">Loading shortlist…</p>
      </main>
    );
  return (
    <main>
      <h1>{data.name}</h1>
      <p>{data.items.length} items</p>
      {data.items.length ? (
        <ul>
          {data.items.map((item) => (
            <li key={item.id}>
              {item.profitResult.supplierRow.normalizedOffer?.description ??
                "Unnamed item"}{" "}
              — {item.profitResult.recommendation ?? "No decision"}{" "}
              <label>
                Status{" "}
                <select
                  value={item.status}
                  onChange={(event) =>
                    void transition(item.id, event.target.value)
                  }
                >
                  <option>RESEARCH</option>
                  <option>REVIEW</option>
                  <option>READY_FOR_PO</option>
                  <option>ON_HOLD</option>
                  <option>REJECTED</option>
                  <option>ORDERED</option>
                </select>
              </label>
              <label>
                Requested units{" "}
                <input
                  type="number"
                  min={1}
                  value={requestedUnits[item.id] ?? "20"}
                  onChange={(event) =>
                    setRequestedUnits((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p>No items have been added.</p>
      )}
      {data.items.length ? (
        <p>
          <button type="button" onClick={() => void createPurchaseOrder()}>
            Build current-scenario PO
          </button>{" "}
          <button type="button" onClick={() => void exportShortlist("CSV")}>
            Export shortlist CSV
          </button>{" "}
          <button type="button" onClick={() => void exportShortlist("XLSX")}>
            Export shortlist XLSX
          </button>
        </p>
      ) : null}
    </main>
  );
}
