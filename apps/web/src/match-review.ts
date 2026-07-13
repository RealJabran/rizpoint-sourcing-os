import { z } from "zod";

export const matchReviewInputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("USER_ACCEPTED"),
    selectedCandidateId: z.string().min(1),
  }),
  z.object({
    status: z.literal("USER_REJECTED"),
    selectedCandidateId: z.string().min(1).nullable(),
  }),
]);
