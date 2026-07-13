import { describe, expect, it } from "vitest";
import {
  createPurchaseOrderSchema,
  transitionShortlistItemsSchema,
} from "../src/phase-six/contracts.js";
describe("phase six API contracts", () => {
  it("accepts bounded integer order quantities", () =>
    expect(
      createPurchaseOrderSchema.safeParse({
        shortlistId: "list",
        itemIds: ["item"],
        scenarioType: "CURRENT",
        idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
        quantities: { item: { requestedUnits: 20 } },
      }).success,
    ).toBe(true));
  it("rejects fractional cases", () =>
    expect(
      createPurchaseOrderSchema.safeParse({
        shortlistId: "list",
        itemIds: ["item"],
        scenarioType: "CURRENT",
        idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
        quantities: { item: { requestedUnits: 1.5 } },
      }).success,
    ).toBe(false));
  it("requires an idempotency key for bulk status transitions", () =>
    expect(
      transitionShortlistItemsSchema.safeParse({
        itemIds: ["item"],
        status: "RESEARCH",
      }).success,
    ).toBe(false));
});
