import { afterEach, describe, expect, it, vi } from "vitest";

const listExpiredExportObjects = vi.fn();
const acknowledgeExpiredExportObject = vi.fn();
const recordExpiredExportRetentionReport = vi.fn();
const listExpiredProviderEvidence = vi.fn();
const acknowledgeExpiredProviderEvidence = vi.fn();
const listExpiredHistoricalMetricPoints = vi.fn();
const deleteExpiredHistoricalMetricPoints = vi.fn();
const deleteExpiredApiRateLimitBuckets = vi.fn();
const deletePrivateObject = vi.fn();

vi.mock("@rizpoint/database", () => ({
  listExpiredExportObjects,
  acknowledgeExpiredExportObject,
  recordExpiredExportRetentionReport,
  listExpiredProviderEvidence,
  acknowledgeExpiredProviderEvidence,
  listExpiredHistoricalMetricPoints,
  deleteExpiredHistoricalMetricPoints,
  deleteExpiredApiRateLimitBuckets,
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
    listExpiredProviderEvidence.mockResolvedValue([]);
    listExpiredHistoricalMetricPoints.mockResolvedValue([
      { id: "point_1", organizationId: "org_1" },
    ]);
    deleteExpiredApiRateLimitBuckets.mockResolvedValue(3);
    const { runRetentionOnce } = await import("../src/retention.js");
    await expect(runRetentionOnce(new Date())).resolves.toBe(5);
    expect(recordExpiredExportRetentionReport).toHaveBeenCalledOnce();
    expect(deletePrivateObject).not.toHaveBeenCalled();
    expect(deleteExpiredHistoricalMetricPoints).not.toHaveBeenCalled();
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
    listExpiredProviderEvidence.mockResolvedValue([]);
    listExpiredHistoricalMetricPoints.mockResolvedValue([
      { id: "point_1", organizationId: "org_1" },
    ]);
    deleteExpiredHistoricalMetricPoints.mockResolvedValue(1);
    deleteExpiredApiRateLimitBuckets.mockResolvedValue(2);
    const { runRetentionOnce } = await import("../src/retention.js");
    await runRetentionOnce(new Date());
    expect(deletePrivateObject).toHaveBeenCalledWith("exports/org_1/a.csv");
    expect(acknowledgeExpiredExportObject).toHaveBeenCalledWith(
      "export_1",
      "org_1",
    );
    expect(deleteExpiredHistoricalMetricPoints).toHaveBeenCalledWith(
      [{ id: "point_1", organizationId: "org_1" }],
      expect.any(Date),
    );
  });
});
