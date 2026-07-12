import assert from "node:assert/strict";

const baseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const idempotencyKey = "phase-one-upload-mapping-integration-key";

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
    sizeBytes: 81,
  }),
});
assert.equal(createdResponse.status, 200);
const created = (await createdResponse.json()) as {
  uploadId: string;
  scanId: string;
  uploadUrl: string;
};

const putResponse = await fetch(created.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "text/csv" },
  body: "UPC,Description,Unit Cost\n012345678905,Synthetic widget,12.50\n",
});
assert.ok(putResponse.ok, `signed object PUT failed: ${putResponse.status}`);

const inspectionResponse = await fetch(
  `${baseUrl}/api/uploads/${created.uploadId}/inspect`,
  { method: "POST" },
);
assert.equal(inspectionResponse.status, 202);

type UploadState = {
  status: string;
  scan: { id: string; status: string } | null;
  sheets: Array<{ id: string; headerCandidates: Array<{ row: number }> }>;
};

async function waitFor(expectedStatus: string): Promise<UploadState> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
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
console.log(`integration upload/mapping completed: ${created.uploadId}`);
