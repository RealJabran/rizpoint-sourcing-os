import { z } from "zod";

export const categoryListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(500_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  marketplaceId: z.string().trim().min(1).max(32).optional(),
});

export const categoryActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SAVE_TO_PROJECT"),
    projectId: z.string().min(1),
    marketplaceId: z.string().trim().min(1).max(32),
    categoryReference: z.string().trim().min(1).max(240),
    categoryName: z.string().trim().min(1).max(240),
  }),
  z.object({
    action: z.literal("WATCH"),
    projectId: z.string().min(1).optional(),
    marketplaceId: z.string().trim().min(1).max(32),
    categoryReference: z.string().trim().min(1).max(240),
    categoryName: z.string().trim().min(1).max(240),
  }),
]);
