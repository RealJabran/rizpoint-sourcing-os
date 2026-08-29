import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listExpiredExportObjects = vi.fn();
const acknowledgeExpiredExportObject = vi.fn();
const recordExpiredExportRetentionReport = vi.fn();
const listExpiredProviderEvidence = vi.fn();
const acknowledgeExpiredProviderEvidence = vi.fn();
const listExpiredHistoricalMetricPoints = vi.fn();
const deleteExpiredHistoricalMetricPoints = vi.fn();
const deleteExpiredApiRateLimitBuckets = vi.fn();
const deletePrivateObject = vi.fn();
const listOrganizationsWithAmazonInformation = vi.fn();
const listAmazonInformationCandidates = vi.fn();
const deleteAmazonInformationCandidates = vi.fn();
const listPendingAmazonDeletionScopes = vi.fn();
const minimizeExpiredGlobalAmazonCatalogProducts = vi.fn();
const recordAmazonRetentionRun = vi.fn();
const markAmazonDeletionAttempt = vi.fn();
const completeAmazonDeletionRequest = vi.fn();
const markAmazonTombstoneReapplied = vi.fn();

vi.mock("@rizpoint/database", () => ({
  listExpiredExportObjects,
  acknowledgeExpiredExportObject,
  recordExpiredExportRetentionReport,
  listExpiredProviderEvidence,
  acknowledgeExpiredProviderEvidence,
  listExpiredHistoricalMetricPoints,
  deleteExpiredHistoricalMetricPoints,
  deleteExpiredApiRateLimitBuckets,
  listOrganizationsWithAmazonInformation,
  listAmazonInformationCandidates,
  deleteAmazonInformationCandidates,
  listPendingAmazonDeletionScopes,
  minimizeExpiredGlobalAmazonCatalogProducts,
  recordAmazonRetentionRun,
  markAmazonDeletionAttempt,
  completeAmazonDeletionRequest,
  markAmazonTombstoneReapplied,
}));
vi.mock("@rizpoint/object-storage", () => ({ deletePrivateObject }));

describe("export retention", () => {
  const emptyCounts = {
    PROVIDER_CACHE: 0,
    PROVIDER_OBSERVATION: 0,
    RESEARCH_OBSERVATION: 0,
    PRODUCT_RESEARCH_ITEM: 0,
    MARKETPLACE_PARTICIPATION: 0,
    HISTORICAL_POINT: 0,
    PROJECT_EVIDENCE: 0,
    DECISION_SOURCE: 0,
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    listOrganizationsWithAmazonInformation.mockResolvedValue([]);
    listPendingAmazonDeletionScopes.mockResolvedValue({
      requests: [],
      tombstones: [],
    });
    minimizeExpiredGlobalAmazonCatalogProducts.mockResolvedValue(0);
    listAmazonInformationCandidates.mockResolvedValue([]);
    deleteAmazonInformationCandidates.mockResolvedValue(emptyCounts);
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

  it("deletes Amazon objects before tenant records and records bounded evidence", async () => {
    listOrganizationsWithAmazonInformation.mockResolvedValue(["org_1"]);
    listAmazonInformationCandidates.mockResolvedValue([
      {
        id: "cache_1",
        organizationId: "org_1",
        kind: "PROVIDER_CACHE",
        observedAt: new Date("2025-01-01T00:00:00.000Z"),
        objectReference: "provider/org_1/evidence.json",
      },
    ]);
    deleteAmazonInformationCandidates.mockResolvedValue({
      ...emptyCounts,
      PROVIDER_CACHE: 1,
    });
    const { runAmazonInformationRetentionOnce } =
      await import("../src/retention.js");
    await expect(
      runAmazonInformationRetentionOnce(new Date("2026-08-01T00:00:00.000Z")),
    ).resolves.toBe(1);
    expect(deletePrivateObject).toHaveBeenCalledWith(
      "provider/org_1/evidence.json",
    );
    expect(deleteAmazonInformationCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        objectDeletionConfirmedIds: new Set(["cache_1"]),
      }),
    );
    expect(recordAmazonRetentionRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "COMPLETED" }),
    );
  });

  it("retains the database reference and records a retry when object deletion fails", async () => {
    listOrganizationsWithAmazonInformation.mockResolvedValue(["org_1"]);
    listAmazonInformationCandidates.mockResolvedValue([
      {
        id: "cache_retry",
        organizationId: "org_1",
        kind: "PROVIDER_CACHE",
        observedAt: new Date("2025-01-01T00:00:00.000Z"),
        objectReference: "provider/org_1/retry.json",
      },
    ]);
    deletePrivateObject.mockRejectedValueOnce(new Error("OBJECT_UNAVAILABLE"));
    deleteAmazonInformationCandidates.mockResolvedValue(emptyCounts);
    const { runAmazonInformationRetentionOnce } =
      await import("../src/retention.js");
    await expect(runAmazonInformationRetentionOnce(new Date())).resolves.toBe(
      0,
    );
    expect(deleteAmazonInformationCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ objectDeletionConfirmedIds: new Set() }),
    );
    expect(recordAmazonRetentionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PARTIAL_FAILURE",
        failureCode: "OBJECT_DELETION_RETRY_REQUIRED",
      }),
    );
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
