import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = {
  shortlist: { findFirst: vi.fn() },
  purchaseOrder: { findFirst: vi.fn() },
};
const database = {
  $transaction: vi.fn(
    async (operation: (client: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
  ),
};

vi.mock("../src/client.js", () => ({ db: database }));

describe("export source authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a shortlist owned by another tenant before creating a job", async () => {
    transaction.shortlist.findFirst.mockResolvedValue(null);
    const { queueExport } = await import("../src/repositories.js");
    await expect(
      queueExport({
        organizationId: "org-current",
        kind: "SHORTLIST",
        format: "CSV",
        shortlistId: "shortlist-other-tenant",
        sourceRevision: 1,
        idempotencyKey: "export-cross-tenant-shortlist",
      }),
    ).rejects.toThrow("SHORTLIST_EXPORT_SOURCE_NOT_FOUND");
    expect(transaction.shortlist.findFirst).toHaveBeenCalledWith({
      where: {
        id: "shortlist-other-tenant",
        organizationId: "org-current",
      },
      select: { revision: true },
    });
  });

  it("rejects a purchase order owned by another tenant", async () => {
    transaction.purchaseOrder.findFirst.mockResolvedValue(null);
    const { queueExport } = await import("../src/repositories.js");
    await expect(
      queueExport({
        organizationId: "org-current",
        kind: "PURCHASE_ORDER",
        format: "XLSX",
        purchaseOrderId: "po-other-tenant",
        sourceRevision: 2,
        idempotencyKey: "export-cross-tenant-po",
      }),
    ).rejects.toThrow("PURCHASE_ORDER_EXPORT_SOURCE_NOT_FOUND");
  });
});
