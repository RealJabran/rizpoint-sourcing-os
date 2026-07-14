import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const catalog = [
  "UPC,Description,Unit Cost,Case Count",
  "012345678905,Acme Lemon Soda 12 oz Pack of 6,0.50,12",
  "",
].join("\n");

const suppliersResponse = await fetch(`${baseUrl}/api/suppliers`);
assert.equal(suppliersResponse.status, 200);
const suppliers = (await suppliersResponse.json()) as Array<{
  id: string;
  code: string;
}>;
const vsi = suppliers.find((supplier) => supplier.code === "VSI");
assert.ok(vsi);

const uploadResponse = await fetch(`${baseUrl}/api/uploads/presign`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": `phase-four-${Date.now()}`,
  },
  body: JSON.stringify({
    supplierId: vsi.id,
    filename: "phase-four-fixture.csv",
    contentType: "text/csv",
    sizeBytes: Buffer.byteLength(catalog),
  }),
});
assert.equal(uploadResponse.status, 200);
const upload = (await uploadResponse.json()) as {
  uploadId: string;
  scanId: string;
  uploadUrl: string;
};
assert.equal(
  (
    await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/csv" },
      body: catalog,
    })
  ).status,
  200,
);
assert.equal(
  (
    await fetch(`${baseUrl}/api/uploads/${upload.uploadId}/inspect`, {
      method: "POST",
    })
  ).status,
  202,
);

async function poll<T>(
  read: () => Promise<T | null>,
  label: string,
): Promise<T> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

type UploadState = {
  status: string;
  sheets: Array<{ id: string; headerCandidates: Array<{ row: number }> }>;
};
const inspected = await poll(async () => {
  const response = await fetch(`${baseUrl}/api/uploads/${upload.uploadId}`);
  const state = (await response.json()) as UploadState;
  return state.status === "MAPPING_REQUIRED" ? state : null;
}, "mapping");
const sheet = inspected.sheets[0]!;
assert.equal(
  (
    await fetch(`${baseUrl}/api/scans/${upload.scanId}/mapping`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadSheetId: sheet.id,
        headerRow: sheet.headerCandidates[0]?.row ?? 1,
        mappings: [
          {
            sourceIndex: 0,
            sourceColumn: "UPC",
            target: "UPC",
            required: true,
          },
          {
            sourceIndex: 1,
            sourceColumn: "Description",
            target: "DESCRIPTION",
            required: true,
          },
          {
            sourceIndex: 2,
            sourceColumn: "Unit Cost",
            target: "UNIT_COST",
            required: true,
          },
          {
            sourceIndex: 3,
            sourceColumn: "Case Count",
            target: "CASE_COUNT",
            required: false,
          },
        ],
      }),
    })
  ).status,
  200,
);
assert.equal(
  (
    await fetch(`${baseUrl}/api/scans/${upload.scanId}/normalize`, {
      method: "POST",
    })
  ).status,
  202,
);
await poll(async () => {
  const response = await fetch(`${baseUrl}/api/scans/${upload.scanId}`);
  return ((await response.json()) as { status: string }).status === "COMPLETED"
    ? true
    : null;
}, "normalization");
assert.equal(
  (
    await fetch(`${baseUrl}/api/scans/${upload.scanId}/match`, {
      method: "POST",
    })
  ).status,
  202,
);
await poll(async () => {
  const response = await fetch(`${baseUrl}/api/scans/${upload.scanId}`);
  return ((await response.json()) as { status: string }).status === "COMPLETED"
    ? true
    : null;
}, "matching");
assert.equal(
  (
    await fetch(`${baseUrl}/api/scans/${upload.scanId}/enrich`, {
      method: "POST",
    })
  ).status,
  202,
);
await poll(async () => {
  const response = await fetch(
    `${baseUrl}/api/scans/${upload.scanId}/enrichment`,
  );
  const runs = (await response.json()) as Array<{ status: string }>;
  return runs[0]?.status === "COMPLETED" ? true : null;
}, "enrichment");

assert.equal(
  (
    await fetch(`${baseUrl}/api/financial-policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        currency: "USD",
        minNetProfit: "3.00",
        minRoiPercent: "30.00",
        minMarginPercent: "10.00",
        maxStressLoss: "0.00",
        stressDiscountPercent: "10.00",
      }),
    })
  ).status,
  200,
);
assert.equal(
  (
    await fetch(`${baseUrl}/api/shipping-routes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Integration route",
        currency: "USD",
        effectiveFrom: "2026-01-01T00:00:00Z",
        allocatedSupplierFreight: "0.50",
        prepFee: "0.25",
        labelingFee: "0.10",
        polybagFee: "0.10",
        bundleFee: "0.00",
        bubblewrapFee: "0.00",
        inboundShipping: "0.75",
        dutyOrTax: "0.00",
        storageAllowance: "0.20",
        returnAllowance: "0.30",
        otherCosts: "0.00",
      }),
    })
  ).status,
  201,
);
assert.equal(
  (
    await fetch(`${baseUrl}/api/brand-policies`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand: "Acme", status: "UNRESTRICTED" }),
    })
  ).status,
  200,
);
assert.equal(
  (
    await fetch(`${baseUrl}/api/scans/${upload.scanId}/calculate`, {
      method: "POST",
    })
  ).status,
  202,
);
const results = await poll(async () => {
  const response = await fetch(`${baseUrl}/api/scans/${upload.scanId}/profit`);
  const values = (await response.json()) as Array<{
    recommendation: string | null;
    evidence: unknown;
    inputSnapshot: unknown;
  }>;
  return values.length === 1 ? values : null;
}, "profit calculation");
assert.equal(results[0]?.recommendation, "BUY");
assert.ok(results[0]?.evidence);
assert.ok(results[0]?.inputSnapshot);

const workspaceResponse = await fetch(
  `${baseUrl}/api/scans/${upload.scanId}/results?limit=100`,
);
assert.equal(workspaceResponse.status, 200);
const workspace = (await workspaceResponse.json()) as {
  rows: Array<{
    id: string;
    currentNetProfit: string | null;
    evidence?: unknown;
    supplierRow: {
      profitCostOverrides: Array<{ revision: number; status: string }>;
    };
  }>;
};
const workspaceResult = workspace.rows[0];
assert.ok(workspaceResult);
assert.equal(workspaceResult?.evidence, undefined);
assert.ok(workspaceResult?.currentNetProfit);

const shortlistResponse = await fetch(`${baseUrl}/api/shortlists`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: `phase-six-${Date.now()}`,
    idempotencyKey: randomUUID(),
  }),
});
assert.equal(shortlistResponse.status, 201);
const shortlist = (await shortlistResponse.json()) as { id: string };
assert.equal(
  (
    await fetch(`${baseUrl}/api/shortlists/${shortlist.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resultIds: [workspaceResult!.id],
        idempotencyKey: randomUUID(),
      }),
    })
  ).status,
  201,
);
const shortlistDetail = (await (
  await fetch(`${baseUrl}/api/shortlists/${shortlist.id}`)
).json()) as { items: Array<{ id: string }> };
assert.equal(shortlistDetail.items.length, 1);
const poResponse = await fetch(`${baseUrl}/api/purchase-orders`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    shortlistId: shortlist.id,
    itemIds: [shortlistDetail.items[0]!.id],
    scenarioType: "CURRENT",
    budgetAmount: "1000.00",
    idempotencyKey: randomUUID(),
    quantities: {
      [shortlistDetail.items[0]!.id]: {
        requestedUnits: 13,
        minimumOrderCases: 1,
        orderMultipleCases: 1,
      },
    },
  }),
});
assert.equal(poResponse.status, 201);
const purchaseOrder = (await poResponse.json()) as {
  id: string;
  revision: number;
  supplierSubtotal: string;
  projectedProfitTotal: string;
};
assert.ok(Number(purchaseOrder.supplierSubtotal) > 0);
assert.equal(
  (
    await fetch(`${baseUrl}/api/purchase-orders/${purchaseOrder.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: purchaseOrder.revision,
        idempotencyKey: randomUUID(),
      }),
    })
  ).status,
  200,
);
const exportResponse = await fetch(
  `${baseUrl}/api/purchase-orders/${purchaseOrder.id}/exports`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "PURCHASE_ORDER",
      format: "CSV",
      idempotencyKey: randomUUID(),
    }),
  },
);
assert.equal(exportResponse.status, 202);
const exportJob = (await exportResponse.json()) as { id: string };
await poll(async () => {
  const response = await fetch(`${baseUrl}/api/exports/${exportJob.id}`);
  const value = (await response.json()) as {
    status: string;
    downloadUrl?: string;
  };
  return value.status === "COMPLETED" ? value : null;
}, "purchase-order export");
const downloadedExport = await fetch(
  `${baseUrl}/api/exports/${exportJob.id}?download=1`,
);
assert.equal(downloadedExport.status, 200);
const csv = await downloadedExport.text();
assert.match(csv, /"PO ID"/);
assert.match(csv, /"PO supplier subtotal"/);
assert.match(csv, new RegExp(`"${purchaseOrder.supplierSubtotal}"`));
assert.match(csv, new RegExp(`"${purchaseOrder.projectedProfitTotal}"`));

assert.equal(
  (
    await fetch(`${baseUrl}/api/analysis-views`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scanId: upload.scanId,
        name: `phase-five-${Date.now()}`,
        queryState: {
          schemaVersion: 1,
          recommendation: "BUY",
          status: "COMPLETED",
          minRoiPercent: "-5",
          sort: "roiPercent",
          direction: "desc",
          visibleGroups: ["identity", "decision", "economics"],
        },
      }),
    })
  ).status,
  201,
);

assert.equal(
  (
    await fetch(`${baseUrl}/api/results/${workspaceResult?.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        reason: "Integration cost correction",
        values: [{ field: "SUPPLIER_COST_PER_SELLABLE_UNIT", value: "0.60" }],
      }),
    })
  ).status,
  202,
);
const recalculated = await poll(async () => {
  const response = await fetch(
    `${baseUrl}/api/scans/${upload.scanId}/results?limit=100`,
  );
  const value = (await response.json()) as typeof workspace;
  const result = value.rows[0];
  return result?.supplierRow.profitCostOverrides[0]?.status === "APPLIED"
    ? result
    : null;
}, "targeted recalculation");
const replayResponse = await fetch(
  `${baseUrl}/api/results/${recalculated.id}/replay`,
  { method: "POST" },
);
assert.equal(replayResponse.status, 200);
assert.equal(
  ((await replayResponse.json()) as { matchesPersisted: boolean })
    .matchesPersisted,
  true,
);
assert.equal(
  (
    await fetch(`${baseUrl}/api/results/bulk-action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "RECALCULATE",
        resultIds: [recalculated.id],
        idempotencyKey: randomUUID(),
      }),
    })
  ).status,
  202,
);
console.log(`integration profit calculation completed: ${upload.scanId}`);
