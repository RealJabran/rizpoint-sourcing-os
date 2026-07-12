import { z } from "zod";

export const supportedUploadExtensions = [".csv", ".xls", ".xlsx"] as const;
export const maxUploadBytes = 50 * 1024 * 1024;

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
    filename.includes("\0")
  )
    throw new Error("UNSAFE_FILENAME");
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
      ["ASIN", "UPC", "EAN", "GTIN", "ITEM_NUMBER"].includes(target),
    )
  )
    throw new Error("IDENTIFIER_MAPPING_REQUIRED");
}
