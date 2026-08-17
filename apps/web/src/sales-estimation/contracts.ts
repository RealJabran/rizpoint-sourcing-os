import { z } from "zod";
export const salesEstimateRequestSchema = z.object({
  asin: z
    .string()
    .trim()
    .regex(/^B[A-Z0-9]{9}$/),
});
