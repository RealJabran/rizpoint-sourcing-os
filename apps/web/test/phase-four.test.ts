import { describe, expect, it } from "vitest";
import {
  financialPolicySchema,
  shippingRouteSchema,
} from "../src/phase-four.js";

const route = {
  name: "Primary FBA route",
  currency: "USD",
  effectiveFrom: "2026-07-13T00:00:00Z",
  allocatedSupplierFreight: "0.50",
  prepFee: "0.25",
  labelingFee: "0.10",
  polybagFee: "0.10",
  bundleFee: "0.00",
  bubblewrapFee: "0.00",
  inboundShipping: "0.75",
  dutyOrTax: "0.00",
  storageAllowance: "0.20",
  returnAllowance: "0.30",
  otherCosts: "0.00",
};

describe("Phase 4 policy validation", () => {
  it("rejects unsafe decision thresholds without binary-number coercion", () => {
    expect(
      financialPolicySchema.safeParse({
        currency: "USD",
        minNetProfit: "-1",
        minRoiPercent: "30",
        minMarginPercent: "10",
        maxStressLoss: "0",
        stressDiscountPercent: "10",
      }).success,
    ).toBe(false);
    expect(
      financialPolicySchema.safeParse({
        currency: "USD",
        minNetProfit: "3",
        minRoiPercent: "30",
        minMarginPercent: "10",
        maxStressLoss: "0",
        stressDiscountPercent: "100",
      }).success,
    ).toBe(false);
  });

  it("accepts complete route cost inputs and rejects negative allocations", () => {
    expect(shippingRouteSchema.safeParse(route).success).toBe(true);
    expect(
      shippingRouteSchema.safeParse({ ...route, inboundShipping: "-0.01" })
        .success,
    ).toBe(false);
  });
});
