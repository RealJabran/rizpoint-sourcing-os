import { z } from "zod";

const reviewMetadata = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
});

export const matchReviewInputSchema = z.discriminatedUnion("status", [
  reviewMetadata.extend({
    status: z.literal("USER_ACCEPTED"),
    selectedCandidateId: z.string().min(1),
  }),
  reviewMetadata.extend({
    status: z.literal("USER_REJECTED"),
    selectedCandidateId: z.string().min(1).nullable(),
  }),
]);
