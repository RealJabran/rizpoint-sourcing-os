import { z } from "zod";

const mockScanResponseSchema = z.object({
  scanner: z.literal("mock"),
  row_count: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});

export type MockScanResponse = z.infer<typeof mockScanResponseSchema>;

const scannerBaseUrl = process.env.SCANNER_BASE_URL ?? "http://127.0.0.1:8000";

export async function requestMockScan(
  scanJobId: string,
): Promise<MockScanResponse> {
  const response = await fetch(`${scannerBaseUrl}/v1/mock-scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scan_job_id: scanJobId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Scanner returned ${response.status}.`);
  return mockScanResponseSchema.parse(await response.json());
}

export async function scannerReady(): Promise<boolean> {
  try {
    const response = await fetch(`${scannerBaseUrl}/ready`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
