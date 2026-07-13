import { z } from "zod";
import { Decimal } from "decimal.js";
const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((value) => new Decimal(value).gte(0));
const idempotency = z.string().uuid();

export const createShortlistSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  idempotencyKey: idempotency,
});
export const addShortlistItemsSchema = z.object({
  resultIds: z.array(z.string().min(1)).min(1).max(500),
  idempotencyKey: idempotency,
});
export const transitionShortlistItemsSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(500),
  status: z.enum([
    "RESEARCH",
    "REVIEW",
    "READY_FOR_PO",
    "ON_HOLD",
    "REJECTED",
    "ORDERED",
  ]),
  ownerReference: z.string().trim().max(120).nullable().optional(),
  expectedRevision: z.number().int().min(0).optional(),
  idempotencyKey: idempotency,
});
export const noteSchema = z.object({
  body: z.string().trim().min(1).max(2_000),
  authorReference: z.string().trim().max(120).optional(),
  idempotencyKey: idempotency,
});
export const createPurchaseOrderSchema = z.object({
  shortlistId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1).max(500),
  scenarioType: z.enum(["CURRENT", "CONSERVATIVE", "STRESS", "MAP"]),
  budgetAmount: decimal.optional(),
  minimumOrderAmount: decimal.optional(),
  idempotencyKey: idempotency,
  quantities: z.record(
    z.string().min(1),
    z.object({
      requestedUnits: z.number().int().min(1).max(10_000_000),
      minimumOrderCases: z.number().int().min(1).max(1_000_000).default(1),
      orderMultipleCases: z.number().int().min(1).max(1_000_000).default(1),
    }),
  ),
});
export const validatePurchaseOrderSchema = z.object({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: idempotency,
});
export const exportSchema = z.object({
  kind: z.enum(["PURCHASE_ORDER", "AUDIT_REPORT"]),
  format: z.enum(["CSV", "XLSX"]),
  idempotencyKey: idempotency,
});
export const shortlistExportSchema = z.object({
  format: z.enum(["CSV", "XLSX"]),
  idempotencyKey: idempotency,
});
