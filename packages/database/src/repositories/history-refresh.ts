import { createHash } from "node:crypto";
import { db } from "../client.js";

const ASIN = /^B[A-Z0-9]{9}$/;
const eligibleMatchStates = ["AUTO_ACCEPTED", "USER_ACCEPTED"] as const;

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type QueueHistoryRefreshInput = {
  organizationId: string;
  scanJobId: string;
  idempotencyKey: string;
  asins?: readonly string[];
  historyDays?: number;
  forceRefresh?: boolean;
};

/** Re-arms only due retryable history runs. The attempt-specific outbox key,
 * row-state predicate, and existing provider request lease make concurrent
 * scheduler ticks safe and idempotent. */
export async function requeueDueHistoryRefreshRuns(
  now = new Date(),
  limit = 25,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("HISTORY_RETRY_BATCH_LIMIT_INVALID");
  const due = await db.historyRefreshRun.findMany({
    where: { status: "FAILED_RETRYABLE", retryAt: { lte: now } },
    select: {
      id: true,
      organizationId: true,
      scanJobId: true,
      attemptCount: true,
    },
    orderBy: [{ retryAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  let queued = 0;
  for (const run of due) {
    const claimed = await db.$transaction(async (transaction) => {
      const updated = await transaction.historyRefreshRun.updateMany({
        where: {
          id: run.id,
          organizationId: run.organizationId,
          status: "FAILED_RETRYABLE",
          retryAt: { lte: now },
        },
        data: { status: "PENDING", retryAt: null },
      });
      if (!updated.count) return false;
      const nextAttempt = run.attemptCount + 1;
      await transaction.outboxEvent.create({
        data: {
          organizationId: run.organizationId,
          scanJobId: run.scanJobId,
          eventType: `scan.history.retry.${run.id}.${nextAttempt}`,
          payload: {
            scanJobId: run.scanJobId,
            runId: run.id,
            runAttempt: nextAttempt,
            kind: "HISTORY_REFRESH",
          },
        },
      });
      return true;
    });
    if (claimed) queued += 1;
  }
  return queued;
}

/** Creates one durable, bounded refresh run. ASINs must be products already
 * accepted in the caller's scan, preventing cross-tenant arbitrary lookups. */
export async function queueHistoryRefresh(input: QueueHistoryRefreshInput) {
  const historyDays = input.historyDays ?? 365;
  if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 730)
    throw new Error("HISTORY_DAYS_INVALID");
  const explicit = input.asins ? [...new Set(input.asins)] : undefined;
  if (explicit?.some((asin) => !ASIN.test(asin)))
    throw new Error("HISTORY_ASIN_INVALID");
  if (explicit && (explicit.length === 0 || explicit.length > 100))
    throw new Error("HISTORY_BATCH_LIMIT");
  return db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findFirst({
      where: { id: input.scanJobId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!scan) return null;
    const decisions = await transaction.matchDecision.findMany({
      where: {
        organizationId: input.organizationId,
        status: { in: [...eligibleMatchStates] },
        supplierRow: { scanJobId: input.scanJobId },
        selectedCandidateId: { not: null },
      },
      select: {
        selectedCandidate: {
          select: {
            catalogProduct: {
              select: { id: true, asin: true, marketplaceId: true },
            },
          },
        },
      },
    });
    const candidates = new Map<
      string,
      { catalogProductId: string; marketplaceId: string }
    >();
    for (const decision of decisions) {
      const product = decision.selectedCandidate?.catalogProduct;
      if (!product?.asin || !product.marketplaceId || !ASIN.test(product.asin))
        continue;
      candidates.set(product.asin, {
        catalogProductId: product.id,
        marketplaceId: product.marketplaceId,
      });
    }
    const selected = [...candidates.entries()].filter(([asin]) =>
      explicit ? explicit.includes(asin) : true,
    );
    if (!selected.length) return null;
    if (selected.length > 100) throw new Error("HISTORY_BATCH_LIMIT");
    const marketplaceId = selected[0]?.[1].marketplaceId;
    if (
      !marketplaceId ||
      selected.some(([, item]) => item.marketplaceId !== marketplaceId)
    )
      throw new Error("HISTORY_MARKETPLACE_MISMATCH");
    if (explicit && selected.length !== explicit.length)
      throw new Error("HISTORY_ASIN_NOT_IN_SCAN");
    const providerKey =
      process.env.MARKET_HISTORY_PROVIDER_MODE === "keepa"
        ? "keepa"
        : "recorded-history";
    const fingerprint = requestHash({
      scanJobId: input.scanJobId,
      asins: selected.map(([asin]) => asin).sort(),
      marketplaceId,
      historyDays,
      providerKey,
      forceRefresh: input.forceRefresh ?? false,
    });
    const existing = await transaction.historyRefreshRun.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { items: true },
    });
    if (existing) {
      if (existing.requestHash !== fingerprint)
        throw new Error("HISTORY_REFRESH_IDEMPOTENCY_CONFLICT");
      return { ...existing, duplicate: true };
    }
    const run = await transaction.historyRefreshRun.create({
      data: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        providerKey,
        marketplaceId,
        idempotencyKey: input.idempotencyKey,
        requestHash: fingerprint,
        historyDays,
        forceRefresh: input.forceRefresh ?? false,
        items: {
          create: selected.map(([asin, item]) => ({
            asin,
            catalogProductId: item.catalogProductId,
          })),
        },
      },
      include: { items: true },
    });
    await transaction.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        eventType: `scan.history.requested.${run.id}`,
        payload: {
          scanJobId: input.scanJobId,
          runId: run.id,
          kind: "HISTORY_REFRESH",
        },
      },
    });
    return { ...run, duplicate: false };
  });
}

export async function claimHistoryRefreshRun(runId: string) {
  const claimed = await db.historyRefreshRun.updateMany({
    where: {
      id: runId,
      status: { in: ["PENDING", "FAILED_RETRYABLE"] },
    },
    data: {
      status: "RUNNING",
      attemptCount: { increment: 1 },
      errorCode: null,
      retryAt: null,
      completedAt: null,
    },
  });
  if (!claimed.count) return null;
  return db.historyRefreshRun.findUnique({
    where: { id: runId },
    include: { items: { include: { catalogProduct: true } } },
  });
}

export async function completeHistoryRefreshItem(input: {
  organizationId: string;
  itemId: string;
  status:
    | "COMPLETED"
    | "PARTIAL"
    | "UNAUTHORIZED"
    | "THROTTLED"
    | "UNAVAILABLE"
    | "FAILED_RETRYABLE"
    | "FAILED_FINAL";
  observationId?: string;
  rawEvidenceReference?: string;
  errorCode?: string;
}) {
  const result = await db.historyRefreshItem.updateMany({
    where: { id: input.itemId, organizationId: input.organizationId },
    data: {
      status: input.status,
      observationId: input.observationId ?? null,
      rawEvidenceReference: input.rawEvidenceReference ?? null,
      errorCode: input.errorCode ?? null,
      completedAt: [
        "COMPLETED",
        "PARTIAL",
        "UNAUTHORIZED",
        "UNAVAILABLE",
        "FAILED_FINAL",
      ].includes(input.status)
        ? new Date()
        : null,
    },
  });
  if (!result.count) throw new Error("HISTORY_REFRESH_ITEM_NOT_FOUND");
}

export async function completeHistoryRefreshRun(input: {
  runId: string;
  retryAt?: Date;
  errorCode?: string;
}) {
  const run = await db.historyRefreshRun.findUnique({
    where: { id: input.runId },
    include: { items: { select: { status: true } } },
  });
  if (!run) throw new Error("HISTORY_REFRESH_RUN_NOT_FOUND");
  const statuses = run.items.map((item) => item.status);
  const retryable = statuses.some((status) =>
    ["THROTTLED", "FAILED_RETRYABLE"].includes(status),
  );
  const complete = statuses.every((status) => status === "COMPLETED");
  const missingCount = statuses.filter(
    (status) => status !== "COMPLETED",
  ).length;
  return db.historyRefreshRun.update({
    where: { id: run.id },
    data: {
      status: retryable
        ? "FAILED_RETRYABLE"
        : complete
          ? "COMPLETED"
          : "PARTIAL_SUCCESS",
      missingCount,
      errorCode: input.errorCode ?? null,
      retryAt: retryable ? (input.retryAt ?? null) : null,
      completedAt: retryable ? null : new Date(),
    },
  });
}

/** Unexpected worker failures are isolated from the wholesale scan: history is
 * optional evidence and must never downgrade an already-complete scan. */
export async function failHistoryRefreshRun(input: {
  runId: string;
  status: "FAILED_RETRYABLE" | "FAILED_FINAL";
  errorCode: string;
}) {
  const run = await db.historyRefreshRun.findUnique({
    where: { id: input.runId },
    select: { organizationId: true },
  });
  if (!run) return false;
  await db.$transaction([
    db.historyRefreshItem.updateMany({
      where: { historyRefreshRunId: input.runId, status: "PENDING" },
      data: { status: input.status, errorCode: input.errorCode },
    }),
    db.historyRefreshRun.update({
      where: { id: input.runId },
      data: {
        status: input.status,
        errorCode: input.errorCode,
        completedAt: input.status === "FAILED_FINAL" ? new Date() : null,
      },
    }),
  ]);
  return true;
}

export async function getHistoryRefreshRun(
  organizationId: string,
  runId: string,
) {
  return db.historyRefreshRun.findFirst({
    where: { id: runId, organizationId },
    include: { items: { orderBy: { asin: "asc" } } },
  });
}
