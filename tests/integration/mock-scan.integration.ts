import assert from "node:assert/strict";

const baseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const idempotencyKey = "phase-zero-integration-key";

const created = await fetch(`${baseUrl}/api/mock-scans`, {
  method: "POST",
  headers: { "idempotency-key": idempotencyKey },
});
assert.equal(created.status, 202);
const job = (await created.json()) as { id: string; status: string };

const duplicate = await fetch(`${baseUrl}/api/mock-scans`, {
  method: "POST",
  headers: { "idempotency-key": idempotencyKey },
});
assert.equal(duplicate.status, 202);
assert.equal(((await duplicate.json()) as { id: string }).id, job.id);

let finalStatus = "";
let finalResult: unknown = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const statusResponse = await fetch(`${baseUrl}/api/mock-scans/${job.id}`);
  assert.equal(statusResponse.status, 200);
  const status = (await statusResponse.json()) as {
    status: string;
    mockResult: unknown;
  };
  finalStatus = status.status;
  finalResult = status.mockResult;
  if (finalStatus === "COMPLETED") break;
}

assert.equal(finalStatus, "COMPLETED");
assert.deepEqual(finalResult, {
  scanner: "mock",
  row_count: 3,
  checksum: (finalResult as { checksum: string }).checksum,
});
console.log(`integration mock scan completed: ${job.id}`);
