import { z } from "zod";

const ASIN = /^B[A-Z0-9]{9}$/;
const AMAZON_HOSTS = new Set([
  "amazon.com",
  "www.amazon.com",
  "amazon.ca",
  "www.amazon.ca",
  "amazon.co.uk",
  "www.amazon.co.uk",
  "amazon.de",
  "www.amazon.de",
  "amazon.fr",
  "www.amazon.fr",
  "amazon.it",
  "www.amazon.it",
  "amazon.es",
  "www.amazon.es",
  "amazon.co.jp",
  "www.amazon.co.jp",
  "amazon.com.au",
  "www.amazon.com.au",
]);

/** URL parsing is identifier extraction only. It never reads Amazon HTML. */
export function parseAmazonAsin(value: string): string | null {
  const trimmed = value.trim();
  if (ASIN.test(trimmed.toUpperCase())) return trimmed.toUpperCase();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!AMAZON_HOSTS.has(url.hostname.toLowerCase())) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  for (const marker of ["dp", "gp", "product"]) {
    const index = segments.findIndex(
      (segment) => segment.toLowerCase() === marker,
    );
    const candidate = segments[index + 1]?.toUpperCase();
    if (candidate && ASIN.test(candidate)) return candidate;
  }
  return (
    segments
      .map((segment) => segment.toUpperCase())
      .find((segment) => ASIN.test(segment)) ?? null
  );
}

export function normalizeProductLookup(value: string) {
  const asin = parseAmazonAsin(value);
  if (asin) return { queryType: "ASIN" as const, queryText: asin };
  const digits = value.trim();
  if (!/^\d{8,14}$/.test(digits)) return null;
  return {
    queryType:
      digits.length === 12
        ? ("UPC" as const)
        : digits.length === 14
          ? ("GTIN" as const)
          : ("EAN" as const),
    queryText: digits,
  };
}

export const productResearchRequestSchema = z
  .object({
    kind: z.enum(["PRODUCT_LOOKUP", "CATALOG_SEARCH"]),
    query: z.string().trim().min(2).max(2048),
    marketplaceId: z.string().trim().min(1).max(32),
    requestedLimit: z.number().int().min(1).max(20).optional(),
    salePrice: z
      .string()
      .regex(/^\d+(\.\d{1,4})?$/)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    forceRefresh: z.boolean().optional(),
    idempotencyKey: z.string().min(8).max(120),
  })
  .superRefine((value, context) => {
    if (value.kind === "PRODUCT_LOOKUP" && !normalizeProductLookup(value.query))
      context.addIssue({
        code: "custom",
        path: ["query"],
        message:
          "Enter an ASIN, UPC/EAN/GTIN, or supported Amazon product URL.",
      });
  });
