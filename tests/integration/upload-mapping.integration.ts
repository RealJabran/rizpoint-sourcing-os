import assert from "node:assert/strict";

const baseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const idempotencyKey = `phase-one-upload-mapping-${Date.now()}`;

function upcFor(index: number): string {
  const body = String(index).padStart(11, "0");
  const total = [...body]
    .reverse()
    .reduce(
      (sum, digit, position) =>
        sum + Number(digit) * (position % 2 === 0 ? 3 : 1),
      0,
    );
  return `${body}${(10 - (total % 10)) % 10}`;
}

const catalog = [
  "UPC,Description,Unit Cost",
  "012345678905,Acme Lemon Soda 12 oz Pack of 6,12.50",
  ...Array.from(
    { length: 4_968 },
    (_, index) => `${upcFor(index)},Synthetic VSI item ${index},12.50`,
  ),
  "",
].join("\n");

const suppliersResponse = await fetch(`${baseUrl}/api/suppliers`);
assert.equal(suppliersResponse.status, 200);
const suppliers = (await suppliersResponse.json()) as Array<{
  id: string;
  code: string;
}>;
const vsi = suppliers.find((supplier) => supplier.code === "VSI");
assert.ok(vsi, "seeded VSI supplier should exist");

const createdResponse = await fetch(`${baseUrl}/api/uploads/presign`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  },
  body: JSON.stringify({
    supplierId: vsi.id,
    filename: "synthetic-vsi-catalog.csv",
    contentType: "text/csv",
    sizeBytes: Buffer.byteLength(catalog),
  }),
});
assert.equal(createdResponse.status, 200);
const created = (await createdResponse.json()) as {
  uploadId: string;
  scanId: string;
  uploadUrl: string;
};

const duplicateResponse = await fetch(`${baseUrl}/api/uploads/presign`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  },
  body: JSON.stringify({
    supplierId: vsi.id,
    filename: "synthetic-vsi-catalog.csv",
    contentType: "text/csv",
    sizeBytes: Buffer.byteLength(catalog),
  }),
});
assert.equal(duplicateResponse.status, 200);
assert.equal(
  ((await duplicateResponse.json()) as { uploadId: string }).uploadId,
  created.uploadId,
);

const putResponse = await fetch(created.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "text/csv" },
  body: catalog,
});
assert.ok(putResponse.ok, `signed object PUT failed: ${putResponse.status}`);

const inspectionResponse = await fetch(
  `${baseUrl}/api/uploads/${created.uploadId}/inspect`,
  { method: "POST" },
);
assert.equal(inspectionResponse.status, 202);

type UploadState = {
  status: string;
  scan: {
    id: string;
    status: string;
    supplierRows: Array<{ id: string }>;
  } | null;
  sheets: Array<{ id: string; headerCandidates: Array<{ row: number }> }>;
};

async function waitFor(expectedStatus: string): Promise<UploadState> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await fetch(`${baseUrl}/api/uploads/${created.uploadId}`);
    assert.equal(response.status, 200);
    const state = (await response.json()) as UploadState;
    if (state.status === expectedStatus) return state;
  }
  throw new Error(`upload did not reach ${expectedStatus}`);
}

const inspected = await waitFor("MAPPING_REQUIRED");
assert.equal(inspected.sheets.length, 1);
const sheet = inspected.sheets[0]!;
const headerRow = sheet.headerCandidates[0]?.row ?? 1;

const mappingResponse = await fetch(
  `${baseUrl}/api/scans/${created.scanId}/mapping`,
  {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      uploadSheetId: sheet.id,
      headerRow,
      mappings: [
        { sourceIndex: 0, sourceColumn: "UPC", target: "UPC", required: true },
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
      ],
    }),
  },
);
assert.equal(mappingResponse.status, 200);

const profileResponse = await fetch(
  `${baseUrl}/api/scans/${created.scanId}/mapping/save-profile`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "VSI integration profile",
      headerRow,
      mapping: [
        { sourceIndex: 0, sourceColumn: "UPC", target: "UPC", required: true },
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
      ],
    }),
  },
);
assert.equal(profileResponse.status, 200);

const normalizationResponse = await fetch(
  `${baseUrl}/api/scans/${created.scanId}/normalize`,
  { method: "POST" },
);
assert.equal(normalizationResponse.status, 202);
const complete = await waitFor("COMPLETED");
assert.equal(complete.scan?.status, "COMPLETED");
assert.equal(complete.scan?.supplierRows.length, 4_969);

const matchingResponse = await fetch(
  `${baseUrl}/api/scans/${created.scanId}/match`,
  { method: "POST" },
);
assert.equal(matchingResponse.status, 202);

async function waitForMatching(): Promise<void> {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await fetch(`${baseUrl}/api/scans/${created.scanId}`);
    assert.equal(response.status, 200);
    if (((await response.json()) as { status: string }).status === "COMPLETED")
      return;
  }
  throw new Error("matching did not reach COMPLETED");
}

await waitForMatching();
const matchesResponse = await fetch(
  `${baseUrl}/api/scans/${created.scanId}/matches`,
);
assert.equal(matchesResponse.status, 200);
const matches = (await matchesResponse.json()) as Array<{
  status: string;
  selectedCandidate: {
    catalogProduct: { asin: string };
    packGuard: { status: string } | null;
  } | null;
}>;
assert.equal(matches.length, 4_969);
const acme = matches.find(
  (match) => match.selectedCandidate?.catalogProduct.asin === "B000000001",
);
assert.equal(acme?.status, "AUTO_ACCEPTED");
assert.equal(
  acme?.selectedCandidate?.packGuard?.status,
  "BLOCKED_PACK_UNCERTAIN",
);
console.log(`integration upload/mapping completed: ${created.uploadId}`);
