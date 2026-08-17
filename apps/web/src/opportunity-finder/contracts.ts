import { z } from "zod";
export const nicheListSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  minScore: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  minConfidence: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
});
export const nicheActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE"),
    name: z.string().trim().min(1).max(120),
    marketplaceId: z.string().min(1).max(32),
    sourceType: z.enum([
      "SEED_KEYWORD",
      "KEYWORD_CLUSTER",
      "CATEGORY",
      "MANUAL_COMPETITORS",
      "MARKET_DEFINITION",
    ]),
    value: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal("RECALCULATE"),
    nicheId: z.string().min(1),
    lowReviewMaximum: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    stablePriceVolatilityMaximum: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    minimumConfidencePercent: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
  }),
]);
