import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildOrderLine,
  roundOrderQuantity,
  sumOrderLines,
} from "../src/index.js";
const scenario = {
  price: "20.0000",
  effectiveCogs: "8.0000",
  amazonFees: "3.0000",
  netProfit: "9.0000",
  supplierUnitCost: "2.0000",
  currency: "USD",
};
describe("order engine", () => {
  it("rounds requested units to MOQ and carton multiples", () =>
    expect(
      roundOrderQuantity({
        requestedUnits: 13,
        casePack: 6,
        minimumOrderCases: 4,
        orderMultipleCases: 2,
      }),
    ).toEqual({
      requestedCases: 3,
      orderedCases: 4,
      orderedSellableUnits: 24,
    }));
  it("uses decimal scenario totals", () =>
    expect(
      buildOrderLine({
        requestedUnits: 6,
        casePack: 6,
        minimumOrderCases: 1,
        orderMultipleCases: 1,
        scenario,
      }).projectedProfitTotal,
    ).toBe("54.0000"));
  it("never produces fewer units than requested", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 20 }),
        (requestedUnits, casePack, minimumOrderCases, orderMultipleCases) => {
          const value = roundOrderQuantity({
            requestedUnits,
            casePack,
            minimumOrderCases,
            orderMultipleCases,
          });
          return (
            value.orderedSellableUnits >= requestedUnits &&
            value.orderedCases % orderMultipleCases === 0
          );
        },
      ),
    ));
  it("reconciles header totals", () => {
    const line = buildOrderLine({
      requestedUnits: 6,
      casePack: 6,
      minimumOrderCases: 1,
      orderMultipleCases: 1,
      scenario,
    });
    expect(sumOrderLines([line]).projectedRevenueTotal).toBe("120.0000");
  });
});
