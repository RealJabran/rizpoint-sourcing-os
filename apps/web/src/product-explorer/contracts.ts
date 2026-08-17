import { z } from "zod";

const decimal = z.string().regex(/^\d+(\.\d+)?$/);

export const productExplorerQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(500_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  marketplaceId: z.string().trim().min(1).max(32).optional(),
  search: z.string().trim().min(2).max(120).optional(),
  brand: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  minPrice: decimal.optional(),
  maxPrice: decimal.optional(),
  maxReviewCount: z.coerce.number().int().nonnegative().optional(),
  maxPriceVolatilityPercent: decimal.optional(),
  dataCompleteness: z
    .enum(["COMPLETE", "PARTIAL", "INSUFFICIENT_DATA"])
    .optional(),
});

export const productExplorerViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  queryState: productExplorerQuerySchema.omit({ offset: true, limit: true }),
});

export const productExplorerActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SAVE_TO_PROJECT"),
    projectId: z.string().min(1),
    productIds: z.array(z.string().min(1)).min(1).max(100),
  }),
  z.object({
    action: z.literal("WATCH"),
    productIds: z.array(z.string().min(1)).min(1).max(100),
    marketplaceId: z.string().min(1).max(32),
    projectId: z.string().min(1).optional(),
  }),
]);

export const createResearchProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  marketplaceId: z.string().trim().min(1).max(32),
  mode: z.enum(["PRIVATE_LABEL", "WHOLESALE", "MANUAL_ASIN"]),
});

export const PRODUCT_EXPLORER_PRESETS = [
  {
    id: "low-review-stable-demand",
    label: "Low review, stable history",
    state: { maxReviewCount: 100, maxPriceVolatilityPercent: "15" },
    explanation:
      "Uses stored review count and 90-day price volatility; it does not estimate demand from BSR.",
  },
  {
    id: "complete-history",
    label: "Complete history",
    state: { dataCompleteness: "COMPLETE" },
    explanation:
      "Shows products whose latest history assessment has high coverage.",
  },
] as const;
