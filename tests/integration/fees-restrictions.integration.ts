import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Use the workspace source path so this database-backed test can run both from
// the host workspace and from the worker image, where the root package does not
// own a node_modules symlink for every workspace package.
import {
  db,
  listAnalysisResults,
  persistEnrichmentItem,
} from "../../packages/database/src/index.js";

const suffix = randomUUID();
const organization = await db.organization.create({
  data: { slug: `slice-four-${suffix}`, name: "Slice 4 integration" },
});

try {
  const supplier = await db.supplier.create({
    data: {
      organizationId: organization.id,
      code: `S4-${suffix}`,
      name: "Synthetic Slice 4 supplier",
    },
  });
  const upload = await db.upload.create({
    data: {
      organizationId: organization.id,
      supplierId: supplier.id,
      originalFilename: "synthetic.csv",
      objectKey: `integration/${suffix}`,
      status: "COMPLETED",
      malwareStatus: "CLEAN",
    },
  });
  const sheet = await db.uploadSheet.create({
    data: {
      uploadId: upload.id,
      sheetIndex: 0,
      name: "Sheet1",
      rowCount: 1,
      columnCount: 1,
      headerCandidates: [],
      columns: [],
      preview: [],
    },
  });
  const scan = await db.scanJob.create({
    data: {
      organizationId: organization.id,
      supplierId: supplier.id,
      uploadId: upload.id,
      idempotencyKey: `slice-four-${suffix}`,
      jobType: "CATALOG_IMPORT",
      status: "ENRICHING",
    },
  });
  const row = await db.supplierRow.create({
    data: {
      scanJobId: scan.id,
      uploadSheetId: sheet.id,
      sourceRowNumber: 2,
      rawData: { synthetic: true },
      rowChecksum: suffix,
      normalizationStatus: "NORMALIZED",
    },
  });
  const run = await db.enrichmentRun.create({
    data: {
      organizationId: organization.id,
      scanJobId: scan.id,
      status: "RUNNING",
    },
  });
  const item = await db.enrichmentItem.create({
    data: {
      enrichmentRunId: run.id,
      supplierRowId: row.id,
      asin: "B000000001",
      status: "RUNNING",
    },
  });
  const policy = await db.financialPolicy.create({
    data: {
      organizationId: organization.id,
      currency: "USD",
      engineVersion: "profit-engine/v3",
      minNetProfit: "3.0000",
      minRoiPercent: "30.0000",
      minMarginPercent: "10.0000",
      maxStressLoss: "0.0000",
      stressDiscountPercent: "10.0000",
    },
  });
  const route = await db.shippingRoute.create({
    data: {
      organizationId: organization.id,
      name: "Synthetic FBA",
      currency: "USD",
      effectiveFrom: new Date("2026-07-18T00:00:00.000Z"),
      allocatedSupplierFreight: "0",
      prepFee: "0",
      labelingFee: "0",
      polybagFee: "0",
      bundleFee: "0",
      bubblewrapFee: "0",
      inboundShipping: "0",
      dutyOrTax: "0",
      storageAllowance: "0",
      returnAllowance: "0",
      otherCosts: "0",
    },
  });
  const calculation = await db.profitCalculationRun.create({
    data: {
      organizationId: organization.id,
      scanJobId: scan.id,
      financialPolicyId: policy.id,
      idempotencyKey: `slice-four-calculation-${suffix}`,
      status: "COMPLETED",
    },
  });
  await db.profitResult.create({
    data: {
      organizationId: organization.id,
      scanJobId: scan.id,
      profitCalculationRunId: calculation.id,
      supplierRowId: row.id,
      shippingRouteId: route.id,
      status: "COMPLETED",
      recommendation: "REVIEW_APPROVAL",
      currentNetProfit: "4.7500",
      currentProceeds: "20.0000",
      effectiveCogs: "10.0000",
      amazonFees: "5.2500",
      roiPercent: "47.5000",
      marginPercent: "23.7500",
      engineVersion: "profit-engine/v3",
      inputSnapshot: { synthetic: true },
      evidence: { synthetic: true },
      reasonCodes: ["SELLER_APPROVAL_REQUIRED"],
    },
  });

  const observedAt = new Date("2026-07-18T12:00:00.000Z");
  const base = {
    provider: "MOCK_AMAZON" as const,
    observedAt,
    freshUntil: new Date("2026-07-18T12:15:00.000Z"),
    freshnessState: "FRESH" as const,
    marketplaceId: "ATVPDKIKX0DER",
    asin: "B000000001",
  };
  await persistEnrichmentItem({
    enrichmentItemId: item.id,
    observations: [
      {
        ...base,
        metricType: "FEES",
        payload: { normalized: true },
        primaryAmount: "5.2500",
        quotedPrice: "20.0000",
        currency: "USD",
        operation: "getMyFeesEstimateForASIN",
        observationStatus: "SUCCESS",
        requestHash: "fee-request-hash",
        requestInputs: { scenarioPrice: "20.0000" },
        completeness: "COMPLETE",
        feeScenarioSource: "CURRENT_FEATURED_OFFER",
        feeFulfillment: "AMAZON",
        feeComponents: [
          {
            feeType: "ReferralFee",
            currency: "USD",
            feeAmount: "3.2500",
            finalFee: "3.2500",
          },
          {
            feeType: "FBAFees",
            currency: "USD",
            feeAmount: "2.0000",
            finalFee: "2.0000",
          },
        ],
      },
      {
        ...base,
        metricType: "RESTRICTIONS",
        payload: { normalized: true },
        operation: "getListingsRestrictions",
        observationStatus: "SUCCESS",
        requestHash: "restriction-request-hash",
        requestInputs: { conditionType: "new_new" },
        completeness: "COMPLETE",
        restrictionState: "APPROVAL_REQUIRED",
        restrictionReasonCodes: ["APPROVAL_REQUIRED"],
        restrictionReasons: [
          { code: "APPROVAL_REQUIRED", message: "Approval required." },
        ],
        restrictionConditionType: "new_new",
      },
    ],
    missingMetrics: [],
  });

  // Same idempotency boundary replaces component rows atomically instead of
  // appending a duplicate observation or retaining stale components.
  await persistEnrichmentItem({
    enrichmentItemId: item.id,
    observations: [
      {
        ...base,
        observedAt: new Date("2026-07-18T12:01:00.000Z"),
        metricType: "FEES",
        payload: { normalized: true, retry: true },
        primaryAmount: "5.2500",
        quotedPrice: "20.0000",
        currency: "USD",
        operation: "getMyFeesEstimateForASIN",
        observationStatus: "SUCCESS",
        requestHash: "fee-request-hash",
        requestInputs: { scenarioPrice: "20.0000" },
        completeness: "COMPLETE",
        feeScenarioSource: "CURRENT_FEATURED_OFFER",
        feeFulfillment: "AMAZON",
        feeComponents: [
          {
            feeType: "AmazonFeesTotal",
            currency: "USD",
            feeAmount: "5.2500",
            finalFee: "5.2500",
          },
        ],
      },
    ],
    missingMetrics: [],
  });

  const observations = await db.providerObservation.findMany({
    where: {
      enrichmentItemId: item.id,
      enrichmentItem: { enrichmentRun: { organizationId: organization.id } },
    },
    include: { feeComponents: true },
  });
  assert.equal(observations.length, 2);
  const fee = observations.find(({ metricType }) => metricType === "FEES");
  const restriction = observations.find(
    ({ metricType }) => metricType === "RESTRICTIONS",
  );
  assert.equal(fee?.primaryAmount?.toString(), "5.25");
  assert.equal(fee?.feeComponents.length, 1);
  assert.equal(fee?.feeComponents[0]?.finalFee.toString(), "5.25");
  assert.equal(restriction?.restrictionState, "APPROVAL_REQUIRED");
  assert.deepEqual(restriction?.restrictionReasonCodes, ["APPROVAL_REQUIRED"]);

  const filtered = await listAnalysisResults({
    organizationId: organization.id,
    scanJobId: scan.id,
    shippingRouteId: route.id,
    offset: 0,
    limit: 10,
    filters: {
      feeCompleteness: "COMPLETE",
      restrictionState: "APPROVAL_REQUIRED",
      restrictionReasonCode: "APPROVAL_REQUIRED",
    },
    sort: "sourceRowNumber",
    direction: "asc",
  });
  assert.equal(filtered?.total, 1);
  assert.equal(filtered?.rows[0]?.feeEstimate.total, "5.25");
  assert.equal(filtered?.rows[0]?.feeEstimate.components.length, 1);
  assert.equal(
    filtered?.rows[0]?.listingRestriction.state,
    "APPROVAL_REQUIRED",
  );
  const excluded = await listAnalysisResults({
    organizationId: organization.id,
    scanJobId: scan.id,
    shippingRouteId: route.id,
    offset: 0,
    limit: 10,
    filters: { restrictionState: "ELIGIBLE" },
    sort: "sourceRowNumber",
    direction: "asc",
  });
  assert.equal(excluded?.total, 0);

  const otherTenantCount = await db.providerObservation.count({
    where: {
      enrichmentItemId: item.id,
      enrichmentItem: {
        enrichmentRun: { organizationId: "another-organization" },
      },
    },
  });
  assert.equal(otherTenantCount, 0);
  console.log("integration fee/restriction persistence completed");
} finally {
  await db.scanJob.deleteMany({ where: { organizationId: organization.id } });
  await db.upload.deleteMany({ where: { organizationId: organization.id } });
  await db.supplier.deleteMany({ where: { organizationId: organization.id } });
  await db.shippingRoute.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.financialPolicy.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.organization.delete({ where: { id: organization.id } });
  await db.$disconnect();
}
