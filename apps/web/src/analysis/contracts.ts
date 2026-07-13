import { z } from "zod";
import {
  ANALYSIS_COST_FIELDS,
  ANALYSIS_SORT_FIELDS,
  ANALYSIS_VIEW_SCHEMA_VERSION,
} from "@rizpoint/domain";
import { Decimal } from "decimal.js";

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const nonNegativeDecimal = decimal.refine((value) => new Decimal(value).gte(0));

export const analysisQuerySchema = z.object({
  routeId: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).max(500_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  recommendation: z
    .enum([
      "BUY",
      "WATCH",
      "REVIEW_MATCH",
      "REVIEW_APPROVAL",
      "REVIEW_COST",
      "AVOID",
      "INSUFFICIENT_DATA",
    ])
    .optional(),
  status: z.enum(["COMPLETED", "PARTIAL_SUCCESS"]).optional(),
  search: z.string().trim().min(2).max(120).optional(),
  minRoiPercent: decimal.optional(),
  maxRoiPercent: decimal.optional(),
  sort: z.enum(ANALYSIS_SORT_FIELDS).default("sourceRowNumber"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

export const analysisViewStateSchema = z.object({
  schemaVersion: z.literal(ANALYSIS_VIEW_SCHEMA_VERSION),
  routeId: z.string().min(1).optional(),
  recommendation: analysisQuerySchema.shape.recommendation,
  status: analysisQuerySchema.shape.status,
  search: z.string().trim().min(2).max(120).optional(),
  minRoiPercent: nonNegativeDecimal.optional(),
  maxRoiPercent: nonNegativeDecimal.optional(),
  sort: z.enum(ANALYSIS_SORT_FIELDS).default("sourceRowNumber"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  visibleGroups: z
    .array(z.enum(["identity", "decision", "economics", "risk"]))
    .min(1),
});

export const saveAnalysisViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  queryState: analysisViewStateSchema,
});

export const overrideSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    values: z
      .array(
        z.object({
          field: z.enum(ANALYSIS_COST_FIELDS),
          value: nonNegativeDecimal.nullable(),
        }),
      )
      .max(12)
      .default([]),
    stressDiscountPercent: nonNegativeDecimal
      .refine((value) => new Decimal(value).lt(100))
      .nullable()
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.values.length === 0 && value.stressDiscountPercent === undefined)
      context.addIssue({
        code: "custom",
        path: ["values"],
        message: "At least one cost or stress assumption is required.",
      });
  });

export const bulkActionSchema = z.object({
  action: z.enum(["RECALCULATE", "CLEAR_COST_OVERRIDE", "APPLY_COST_OVERRIDE"]),
  resultIds: z.array(z.string().min(1)).min(1).max(500),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().min(3).max(500).optional(),
  values: overrideSchema.shape.values.optional(),
  stressDiscountPercent: overrideSchema.shape.stressDiscountPercent,
});
