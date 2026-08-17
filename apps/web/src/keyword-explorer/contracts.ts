import { z } from "zod";
export const keywordExplorerSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  marketplaceId: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  include: z.string().trim().min(1).optional(),
  exclude: z.string().trim().min(1).optional(),
});
