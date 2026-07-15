import { z } from "zod";

export const supportedUploadExtensions = [".csv", ".xls", ".xlsx"] as const;
export const maxUploadBytes = 50 * 1024 * 1024;

const mediaTypesByExtension: Record<string, readonly string[]> = {
  ".csv": [
    "text/csv",
    "application/csv",
    "text/plain",
    "application/octet-stream",
  ],
  ".xls": ["application/vnd.ms-excel", "application/octet-stream"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
};

const uploadErrorMessages: Record<string, string> = {
  INVALID_UPLOAD: "Choose a valid CSV, XLSX, or XLS catalog under 50 MiB.",
  UNSUPPORTED_FILE_TYPE: "Choose a CSV, XLSX, or XLS catalog file.",
  UNSUPPORTED_MEDIA_TYPE:
    "The file type does not match this catalog format. Re-export it as CSV, XLSX, or XLS.",
  UNSAFE_FILENAME:
    "Rename the file without path or control characters and try again.",
  FILE_SIZE_LIMIT: "The catalog exceeds the 50 MiB upload limit.",
  CONTENT_TYPE_MISMATCH:
    "The uploaded file type changed during transfer. Select the file again and retry.",
  UPLOAD_OBJECT_MISSING:
    "The catalog did not reach private storage. Select it again and retry.",
  FILE_SIGNATURE_MISMATCH:
    "The file contents do not match its extension. Export a valid CSV, XLSX, or XLS file.",
  CSV_ENCODING: "CSV files must be UTF-8 encoded.",
  INVALID_XLS: "The XLS workbook could not be read safely.",
  INVALID_XLSX: "The XLSX workbook could not be read safely.",
  ZIP_EXPANSION_LIMIT:
    "The XLSX workbook expands beyond the safe processing limit.",
  SHEET_LIMIT: "The workbook contains too many sheets.",
  ROW_LIMIT: "The workbook exceeds the 50,000-row processing limit.",
  COLUMN_LIMIT: "The workbook exceeds the 200-column processing limit.",
  MALWARE_DETECTED: "The catalog was rejected because malware was detected.",
  MALWARE_SCANNER_UNAVAILABLE:
    "Malware scanning is temporarily unavailable. The catalog was not processed; retry later.",
  MALWARE_SCAN_CONFIGURATION:
    "Malware scanning is not configured correctly. The catalog was not processed.",
};

export function uploadErrorMessage(code: string | null | undefined): string {
  return code
    ? (uploadErrorMessages[code] ?? `Catalog upload failed: ${code}.`)
    : "Catalog upload failed.";
}

export function normalizationWarningMessage(code: string): string {
  if (code === "FORMULA_LIKE_CELL")
    return "Formula-like cell detected. Review this value before using the catalog.";
  return code;
}

export function validateUploadedObjectMetadata(
  contentLength: number | undefined,
  contentType: string | undefined,
  declaredContentType: string | null,
): void {
  if (
    contentLength === undefined ||
    !Number.isInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > maxUploadBytes
  ) {
    throw new Error("FILE_SIZE_LIMIT");
  }
  if (declaredContentType && contentType !== declaredContentType) {
    throw new Error("CONTENT_TYPE_MISMATCH");
  }
}

export const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  headerRow: z.number().int().positive(),
  mapping: z
    .array(
      z.object({
        sourceIndex: z.number().int().nonnegative(),
        sourceColumn: z.string().trim().min(1),
        target: z.enum([
          "ASIN",
          "UPC",
          "EAN",
          "GTIN",
          "MPN",
          "ITEM_NUMBER",
          "DESCRIPTION",
          "BRAND",
          "UNIT_COST",
          "CURRENCY",
          "QUANTITY",
          "CASE_COUNT",
          "PACK_COUNT",
          "WEIGHT",
          "LENGTH",
          "WIDTH",
          "HEIGHT",
        ]),
        required: z.boolean().default(false),
      }),
    )
    .min(1),
});

export const supplierInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(160),
});

export const presignInputSchema = z.object({
  supplierId: z.string().min(1),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(maxUploadBytes),
});

export const mappingInputSchema = z.object({
  uploadSheetId: z.string().min(1),
  headerRow: z.number().int().positive(),
  mappings: z
    .array(
      z.object({
        sourceIndex: z.number().int().nonnegative(),
        sourceColumn: z.string().min(1),
        target: z.enum([
          "ASIN",
          "UPC",
          "EAN",
          "GTIN",
          "MPN",
          "ITEM_NUMBER",
          "DESCRIPTION",
          "BRAND",
          "UNIT_COST",
          "CURRENCY",
          "QUANTITY",
          "CASE_COUNT",
          "PACK_COUNT",
          "WEIGHT",
          "LENGTH",
          "WIDTH",
          "HEIGHT",
        ]),
        required: z.boolean().default(false),
      }),
    )
    .min(1),
});

export function validateFilename(filename: string): void {
  const lower = filename.toLowerCase();
  if (!supportedUploadExtensions.some((extension) => lower.endsWith(extension)))
    throw new Error("UNSUPPORTED_FILE_TYPE");
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    [...filename].some(isControlCharacter)
  )
    throw new Error("UNSAFE_FILENAME");
}

export function validateDeclaredMediaType(
  filename: string,
  contentType: string,
): void {
  const lower = filename.toLowerCase();
  const extension = supportedUploadExtensions.find((candidate) =>
    lower.endsWith(candidate),
  );
  if (!extension) throw new Error("UNSUPPORTED_FILE_TYPE");
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType || !mediaTypesByExtension[extension]?.includes(mediaType))
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
}

export function safeDisplayFilename(filename: string): string {
  return [...filename]
    .map((character) => (isControlCharacter(character) ? "�" : character))
    .join("");
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0);
  return code !== undefined && (code <= 0x1f || code === 0x7f);
}

export function validateMappings(
  mappings: Array<{ sourceIndex: number; target: string }>,
): void {
  const targets = mappings.map((mapping) => mapping.target);
  const indices = mappings.map((mapping) => mapping.sourceIndex);
  if (
    new Set(targets).size !== targets.length ||
    new Set(indices).size !== indices.length
  )
    throw new Error("DUPLICATE_MAPPING");
  if (!targets.includes("DESCRIPTION")) throw new Error("DESCRIPTION_REQUIRED");
  if (
    !targets.some((target) =>
      ["ASIN", "UPC", "EAN", "GTIN", "MPN", "ITEM_NUMBER"].includes(target),
    )
  )
    throw new Error("IDENTIFIER_MAPPING_REQUIRED");
}

export function suggestMapping(
  column: string,
): { target: string; confidence: number } | null {
  const value = column.trim().toLowerCase();
  const suggestions: Array<[RegExp, string, number]> = [
    [/(^|\s|_)asin($|\s|_)/, "ASIN", 0.98],
    [/(^|\s|_)upc($|\s|_)/, "UPC", 0.92],
    [/(^|\s|_)ean($|\s|_)/, "EAN", 0.92],
    [/(^|\s|_)gtin($|\s|_)/, "GTIN", 0.92],
    [/(barcode)/, "UPC", 0.75],
    [/(sku|item.?number|part.?number)/, "ITEM_NUMBER", 0.9],
    [/(title|description|product.?name)/, "DESCRIPTION", 0.9],
    [/(unit.?cost|wholesale.?price|cost|price)/, "UNIT_COST", 0.82],
    [/(currency|curr)/, "CURRENCY", 0.96],
    [/(available|quantity|qty)/, "QUANTITY", 0.86],
    [/(case.?count|case.?pack|case)/, "CASE_COUNT", 0.8],
    [/(pack.?count|units.?per.?pack|pack)/, "PACK_COUNT", 0.8],
    [/(brand|manufacturer)/, "BRAND", 0.9],
    [/(model|mpn)/, "MPN", 0.86],
  ];
  const found = suggestions.find(([pattern]) => pattern.test(value));
  return found ? { target: found[1], confidence: found[2] } : null;
}

export function mappingSafetyIssues(
  mapping: Record<number, string>,
  rows: string[][],
): string[] {
  const targets = Object.values(mapping);
  const issues: string[] = [];
  if (!targets.includes("DESCRIPTION"))
    issues.push("Map a title or description field.");
  if (
    !targets.some((target) =>
      ["ASIN", "UPC", "EAN", "GTIN", "MPN", "ITEM_NUMBER"].includes(target),
    )
  )
    issues.push("Map at least one product identifier before continuing.");
  const caseIndex = Number(
    Object.keys(mapping).find(
      (index) => mapping[Number(index)] === "CASE_COUNT",
    ),
  );
  const packIndex = Number(
    Object.keys(mapping).find(
      (index) => mapping[Number(index)] === "PACK_COUNT",
    ),
  );
  if (Number.isInteger(caseIndex) && Number.isInteger(packIndex)) {
    const contradictory = rows.some((row) => {
      const caseCount = Number(row[caseIndex]);
      const packCount = Number(row[packIndex]);
      return (
        !Number.isInteger(caseCount) ||
        !Number.isInteger(packCount) ||
        caseCount <= 0 ||
        packCount <= 0 ||
        caseCount % packCount !== 0
      );
    });
    if (contradictory)
      issues.push(
        "Case and pack samples do not resolve to whole sellable units. Correct the mapping or catalog before financial analysis.",
      );
  }
  return issues;
}
