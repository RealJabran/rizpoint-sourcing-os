import { describe, expect, it, vi } from "vitest";
import {
  createPurchaseOrderSchema,
  transitionShortlistItemsSchema,
} from "../src/phase-six/contracts.js";
import { scenarioFromResult } from "../src/phase-six/order-input.js";
import { requirePrivateAccess } from "../src/private-access.js";
import { NextRequest } from "next/server";
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
  it("rejects superseded, currency-mismatched, or mathematically inconsistent scenarios", () => {
    const result = {
      isCurrent: true,
      status: "COMPLETED",
      recommendation: "BUY",
      engineVersion: "profit-engine/v1",
      evidence: {
        scenarios: {
          CURRENT: {
            exactValues: {
              effectiveCogs: "8.0000",
              amazonFees: "3.0000",
              netProfit: "8.0000",
            },
            evidence: {
              price: {
                price: "20.0000",
                currency: "USD",
                freshnessState: "FRESH",
                freshUntil: "2099-01-01T00:00:00.000Z",
              },
              feeQuote: {
                currency: "USD",
                freshnessState: "FRESH",
                freshUntil: "2099-01-01T00:00:00.000Z",
              },
            },
          },
        },
      },
      supplierRow: {
        scanJob: { supplierId: "supplier" },
        normalizedOffer: {
          unitCost: { toString: () => "2.0000" },
          currency: "USD",
          caseCount: 6,
        },
        matchDecision: {
          status: "AUTO_ACCEPTED",
          selectedCandidate: { packGuard: { status: "VERIFIED" } },
        },
      },
      shippingRoute: { id: "route", currency: "USD" },
    };
    expect(() => scenarioFromResult(result, "CURRENT")).toThrow(
      "SCENARIO_FORMULA_MISMATCH",
    );
    expect(() =>
      scenarioFromResult({ ...result, isCurrent: false }, "CURRENT"),
    ).toThrow("RESULT_SUPERSEDED");
  });
  it("requires the private access token outside the explicit test/demo exception", () => {
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    vi.stubEnv("RIZPOINT_PRIVATE_ACCESS_TOKEN", "private-token");
    const request = new NextRequest("http://localhost/api/shortlists");
    expect(requirePrivateAccess(request)?.status).toBe(401);
    expect(
      requirePrivateAccess(
        new NextRequest("http://localhost/api/shortlists", {
          headers: { authorization: "Bearer private-token" },
        }),
      ),
    ).toBeNull();
    vi.unstubAllEnvs();
  });
});
