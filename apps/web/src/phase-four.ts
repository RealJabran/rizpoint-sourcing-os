import { z } from "zod";
import { Decimal } from "decimal.js";

const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const nonNegativeDecimal = decimal.refine((value) => new Decimal(value).gte(0));

export const financialPolicySchema = z.object({
  currency: z.string().length(3),
  minNetProfit: nonNegativeDecimal,
  minRoiPercent: nonNegativeDecimal,
  minMarginPercent: nonNegativeDecimal,
  maxStressLoss: z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .refine((value) => new Decimal(value).lte(0)),
  stressDiscountPercent: nonNegativeDecimal.refine((value) =>
    new Decimal(value).lt(100),
  ),
  minimumDemandScore: z.number().int().positive().optional(),
});

export const shippingRouteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  currency: z.string().length(3),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional(),
  active: z.boolean().optional(),
  allocatedSupplierFreight: nonNegativeDecimal,
  prepFee: nonNegativeDecimal,
  labelingFee: nonNegativeDecimal,
  polybagFee: nonNegativeDecimal,
  bundleFee: nonNegativeDecimal,
  bubblewrapFee: nonNegativeDecimal,
  inboundShipping: nonNegativeDecimal,
  dutyOrTax: nonNegativeDecimal,
  storageAllowance: nonNegativeDecimal,
  returnAllowance: nonNegativeDecimal,
  otherCosts: nonNegativeDecimal,
});
