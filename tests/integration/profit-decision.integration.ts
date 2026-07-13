import assert from "node:assert/strict";

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
console.log(`integration profit calculation completed: ${upload.scanId}`);
