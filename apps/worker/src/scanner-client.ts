import { z } from "zod";

const mockScanResponseSchema = z.object({
  scanner: z.literal("mock"),
  row_count: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});

export type MockScanResponse = z.infer<typeof mockScanResponseSchema>;

const workbookInspectionSchema = z.object({
  file_format: z.enum(["CSV", "XLS", "XLSX"]),
  sheets: z.array(
    z.object({
      sheet_index: z.number().int().nonnegative(),
      name: z.string(),
      row_count: z.number().int().nonnegative(),
      column_count: z.number().int().nonnegative(),
      header_candidates: z.array(
        z.object({ row: z.number().int(), score: z.number().int() }),
      ),
      columns: z.array(z.string()),
      preview: z.array(z.array(z.string())),
    }),
  ),
});
export type WorkbookInspection = z.infer<typeof workbookInspectionSchema>;

const normalizedRowsSchema = z.object({
  rows: z.array(
    z.object({
      source_row_number: z.number().int().positive(),
      raw_data: z.record(z.string(), z.string()),
      row_checksum: z.string(),
      offer: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      warnings: z.array(
        z.object({
          code: z.string(),
          severity: z.enum(["INFO", "WARNING", "ERROR"]),
          field: z.string(),
        }),
      ),
    }),
  ),
});
export type NormalizedRows = z.infer<typeof normalizedRowsSchema>;

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

async function requestWorkbook(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${scannerBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("scanner_request_failed");
  return response.json();
}

export async function inspectWorkbook(
  filename: string,
  bytes: Uint8Array,
): Promise<WorkbookInspection> {
  return workbookInspectionSchema.parse(
    await requestWorkbook("/v1/workbooks/inspect", {
      filename,
      content_base64: Buffer.from(bytes).toString("base64"),
    }),
  );
}

export async function normalizeWorkbook(
  filename: string,
  bytes: Uint8Array,
  sheetIndex: number,
  headerRow: number,
  mappings: Array<{ source_index: number; target: string }>,
): Promise<NormalizedRows> {
  return normalizedRowsSchema.parse(
    await requestWorkbook("/v1/workbooks/normalize", {
      filename,
      content_base64: Buffer.from(bytes).toString("base64"),
      sheet_index: sheetIndex,
      header_row: headerRow,
      mappings,
    }),
  );
}
