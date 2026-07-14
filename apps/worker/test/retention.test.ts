import { afterEach, describe, expect, it, vi } from "vitest";

const listExpiredExportObjects = vi.fn();
const acknowledgeExpiredExportObject = vi.fn();
const recordExpiredExportRetentionReport = vi.fn();
const deletePrivateObject = vi.fn();

vi.mock("@rizpoint/database", () => ({
  listExpiredExportObjects,
  acknowledgeExpiredExportObject,
  recordExpiredExportRetentionReport,
}));
vi.mock("@rizpoint/object-storage", () => ({ deletePrivateObject }));

describe("export retention", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("reports by default without deleting private artifacts", async () => {
    listExpiredExportObjects.mockResolvedValue([
      {
        id: "export_1",
        organizationId: "org_1",
        objectKey: "exports/org_1/a.csv",
      },
    ]);
    const { runRetentionOnce } = await import("../src/retention.js");
    await expect(runRetentionOnce(new Date())).resolves.toBe(1);
    expect(recordExpiredExportRetentionReport).toHaveBeenCalledOnce();
    expect(deletePrivateObject).not.toHaveBeenCalled();
  });

  it("deletes then acknowledges only when explicitly enabled", async () => {
    vi.stubEnv("RIZPOINT_RETENTION_MODE", "delete");
    listExpiredExportObjects.mockResolvedValue([
      {
        id: "export_1",
        organizationId: "org_1",
        objectKey: "exports/org_1/a.csv",
      },
    ]);
    const { runRetentionOnce } = await import("../src/retention.js");
    await runRetentionOnce(new Date());
    expect(deletePrivateObject).toHaveBeenCalledWith("exports/org_1/a.csv");
    expect(acknowledgeExpiredExportObject).toHaveBeenCalledWith(
      "export_1",
      "org_1",
    );
  });
});
