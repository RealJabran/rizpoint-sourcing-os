import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "./generated/prisma/client.js";
import { db } from "./client.js";
import {
  AMAZON_INFORMATION_MAX_RETENTION_MONTHS,
  amazonDeletionDeadline,
} from "./amazon-retention-policy.js";
import { RETENTION_BATCH_SIZE } from "./research-performance.js";

export type AmazonInformationRecordKind =
  | "PROVIDER_CACHE"
  | "PROVIDER_OBSERVATION"
  | "RESEARCH_OBSERVATION"
  | "PRODUCT_RESEARCH_ITEM"
  | "MARKETPLACE_PARTICIPATION"
  | "HISTORICAL_POINT"
  | "PROJECT_EVIDENCE"
  | "DECISION_SOURCE";

export type AmazonInformationCandidate = {
  id: string;
  organizationId: string;
  kind: AmazonInformationRecordKind;
  observedAt: Date;
  objectReference: string | null;
};

export type AmazonDeletionCounts = Record<AmazonInformationRecordKind, number>;

const emptyCounts = (): AmazonDeletionCounts => ({
  PROVIDER_CACHE: 0,
  PROVIDER_OBSERVATION: 0,
  RESEARCH_OBSERVATION: 0,
  PRODUCT_RESEARCH_ITEM: 0,
  MARKETPLACE_PARTICIPATION: 0,
  HISTORICAL_POINT: 0,
  PROJECT_EVIDENCE: 0,
  DECISION_SOURCE: 0,
});

function assertBatchLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > RETENTION_BATCH_SIZE)
    throw new Error("AMAZON_RETENTION_BATCH_LIMIT_INVALID");
}

function amazonProviderSql(column: Prisma.Sql) {
  return Prisma.sql`lower(${column}) IN ('amazon-sp-api', 'amazon_sp_api')`;
}

/**
 * Returns one oldest-first, tenant-scoped batch. For ordinary retention,
 * effective expiry is the earliest of the cache/series policy, a shorter
 * entitlement term, and RizPoint's 18-calendar-month ceiling. For a deletion
 * request/tombstone replay, every Amazon record through cutoff is eligible.
 */
export async function listAmazonInformationCandidates(input: {
  organizationId: string;
  now?: Date;
  cutoffAt?: Date;
  marketplaceId?: string;
  limit?: number;
}): Promise<AmazonInformationCandidate[]> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? RETENTION_BATCH_SIZE;
  assertBatchLimit(limit);
  const forced = Boolean(input.cutoffAt);
  const cutoff = input.cutoffAt ?? now;
  const marketplaceScoped = Boolean(input.marketplaceId);
  const marketplaceId = input.marketplaceId ?? "";
  return db.$queryRaw<AmazonInformationCandidate[]>(Prisma.sql`
    WITH candidates AS (
      SELECT cache.id,
             cache.organization_id AS "organizationId",
             'PROVIDER_CACHE'::text AS kind,
             cache.observed_at AS "observedAt",
             cache.raw_evidence_reference AS "objectReference",
             LEAST(
               cache.retain_until,
               cache.observed_at + INTERVAL '18 months',
               COALESCE(
                 cache.observed_at + (entitlement.data_retention_days * INTERVAL '1 day'),
                 cache.observed_at + INTERVAL '18 months'
               )
             ) AS effective_expiry
      FROM provider_cache_entries cache
      LEFT JOIN provider_entitlements entitlement
        ON entitlement.id = cache.entitlement_id
       AND entitlement.organization_id = cache.organization_id
      WHERE cache.organization_id = ${input.organizationId}
        AND ${amazonProviderSql(Prisma.raw("cache.provider_key"))}
        AND (${!marketplaceScoped} OR cache.marketplace_id = ${marketplaceId})

      UNION ALL

      SELECT observation.id,
             run.organization_id AS "organizationId",
             'PROVIDER_OBSERVATION'::text AS kind,
             observation.observed_at AS "observedAt",
             observation.raw_evidence_reference AS "objectReference",
             LEAST(
               observation.observed_at + INTERVAL '18 months',
               COALESCE(
                 observation.observed_at + (
                   SELECT MIN(entitlement.data_retention_days) * INTERVAL '1 day'
                   FROM provider_entitlements entitlement
                   WHERE entitlement.organization_id = run.organization_id
                     AND ${amazonProviderSql(Prisma.raw("entitlement.provider_key"))}
                     AND entitlement.marketplace_id = observation.marketplace_id
                     AND entitlement.data_retention_days IS NOT NULL
                 ),
                 observation.observed_at + INTERVAL '18 months'
               )
             ) AS effective_expiry
      FROM provider_observations observation
      JOIN enrichment_items item ON item.id = observation.enrichment_item_id
      JOIN enrichment_runs run ON run.id = item.enrichment_run_id
      WHERE run.organization_id = ${input.organizationId}
        AND observation.provider = 'AMAZON_SP_API'
        AND (${!marketplaceScoped} OR observation.marketplace_id = ${marketplaceId})

      UNION ALL

      SELECT observation.id,
             observation.organization_id AS "organizationId",
             'RESEARCH_OBSERVATION'::text AS kind,
             observation.observed_at AS "observedAt",
             observation.raw_evidence_reference AS "objectReference",
             LEAST(
               observation.observed_at + INTERVAL '18 months',
               COALESCE(
                 observation.observed_at + (
                   SELECT MIN(entitlement.data_retention_days) * INTERVAL '1 day'
                   FROM provider_entitlements entitlement
                   WHERE entitlement.organization_id = observation.organization_id
                     AND ${amazonProviderSql(Prisma.raw("entitlement.provider_key"))}
                     AND entitlement.marketplace_id = observation.marketplace_id
                     AND entitlement.data_retention_days IS NOT NULL
                 ),
                 observation.observed_at + INTERVAL '18 months'
               )
             ) AS effective_expiry
      FROM research_observations observation
      WHERE observation.organization_id = ${input.organizationId}
        AND ${amazonProviderSql(Prisma.raw("observation.provider_key"))}
        AND (${!marketplaceScoped} OR observation.marketplace_id = ${marketplaceId})

      UNION ALL

      SELECT item.id,
             item.organization_id AS "organizationId",
             'PRODUCT_RESEARCH_ITEM'::text AS kind,
             item.observed_at AS "observedAt",
             NULL::text AS "objectReference",
             item.observed_at + INTERVAL '18 months' AS effective_expiry
      FROM product_research_run_items item
      JOIN product_research_runs run
        ON run.id = item.run_id AND run.organization_id = item.organization_id
      WHERE item.organization_id = ${input.organizationId}
        AND ${amazonProviderSql(Prisma.raw("run.provider_key"))}
        AND item.data_origin IN ('LIVE_AMAZON', 'STORED_AMAZON')
        AND (${!marketplaceScoped} OR run.marketplace_id = ${marketplaceId})

      UNION ALL

      SELECT marketplace.id,
             marketplace.organization_id AS "organizationId",
             'MARKETPLACE_PARTICIPATION'::text AS kind,
             marketplace.observed_at AS "observedAt",
             NULL::text AS "objectReference",
             marketplace.observed_at + INTERVAL '18 months' AS effective_expiry
      FROM provider_connection_marketplaces marketplace
      JOIN provider_connections connection
        ON connection.id = marketplace.provider_connection_id
       AND connection.organization_id = marketplace.organization_id
      WHERE marketplace.organization_id = ${input.organizationId}
        AND connection.provider = 'AMAZON_SP_API'
        AND (${!marketplaceScoped} OR marketplace.marketplace_id = ${marketplaceId})

      UNION ALL

      SELECT point.id,
             point.organization_id AS "organizationId",
             'HISTORICAL_POINT'::text AS kind,
             point.metric_at AS "observedAt",
             NULL::text AS "objectReference",
             LEAST(
               point.metric_at + INTERVAL '18 months',
               point.metric_at + (series.retention_days * INTERVAL '1 day')
             ) AS effective_expiry
      FROM historical_metric_points point
      JOIN historical_metric_series series
        ON series.id = point.series_id
       AND series.organization_id = point.organization_id
      WHERE point.organization_id = ${input.organizationId}
        AND ${amazonProviderSql(Prisma.raw("series.provider_key"))}
        AND (${!marketplaceScoped} OR series.marketplace_id = ${marketplaceId})

      UNION ALL

      SELECT evidence.id,
             evidence.organization_id AS "organizationId",
             'PROJECT_EVIDENCE'::text AS kind,
             COALESCE(evidence.observed_at, evidence.created_at) AS "observedAt",
             CASE
               WHEN evidence.source_reference LIKE 'object:%'
                 THEN substring(evidence.source_reference from 8)
               ELSE NULL
             END AS "objectReference",
             COALESCE(evidence.observed_at, evidence.created_at) + INTERVAL '18 months' AS effective_expiry
      FROM project_evidence_references evidence
      WHERE evidence.organization_id = ${input.organizationId}
        AND ${!marketplaceScoped}
        AND (
          lower(evidence.evidence_type) LIKE '%amazon%'
          OR lower(evidence.source_description) LIKE '%amazon%'
          OR lower(evidence.source_reference) LIKE '%amazon%'
        )

      UNION ALL

      SELECT source.id,
             source.organization_id AS "organizationId",
             'DECISION_SOURCE'::text AS kind,
             source.created_at AS "observedAt",
             NULL::text AS "objectReference",
             source.created_at + INTERVAL '18 months' AS effective_expiry
      FROM decision_memo_sources source
      WHERE source.organization_id = ${input.organizationId}
        AND ${!marketplaceScoped}
        AND lower(source.source_type) LIKE '%amazon%'
    )
    SELECT id, "organizationId", kind, "observedAt", "objectReference"
    FROM candidates
    WHERE CASE
      WHEN ${forced} THEN "observedAt" <= ${cutoff}
      ELSE effective_expiry <= ${now}
    END
    ORDER BY "observedAt" ASC, kind ASC, id ASC
    LIMIT ${limit}
  `);
}

async function deleteCandidate(
  transaction: Prisma.TransactionClient,
  candidate: AmazonInformationCandidate,
): Promise<number> {
  const tenant = candidate.organizationId;
  switch (candidate.kind) {
    case "PROVIDER_CACHE":
      return transaction.$executeRaw(Prisma.sql`
        DELETE FROM provider_cache_entries
        WHERE id = ${candidate.id} AND organization_id = ${tenant}
          AND observed_at = ${candidate.observedAt}
          AND ${amazonProviderSql(Prisma.raw("provider_key"))}
      `);
    case "PROVIDER_OBSERVATION":
      return transaction.$executeRaw(Prisma.sql`
        DELETE FROM provider_observations observation
        USING enrichment_items item, enrichment_runs run
        WHERE observation.id = ${candidate.id}
          AND item.id = observation.enrichment_item_id
          AND run.id = item.enrichment_run_id
          AND run.organization_id = ${tenant}
          AND observation.provider = 'AMAZON_SP_API'
          AND observation.observed_at = ${candidate.observedAt}
      `);
    case "RESEARCH_OBSERVATION": {
      await transaction.historyRefreshItem.updateMany({
        where: { organizationId: tenant, observationId: candidate.id },
        data: { observationId: null, rawEvidenceReference: null },
      });
      await transaction.historicalMetricPoint.deleteMany({
        where: { organizationId: tenant, sourceObservationId: candidate.id },
      });
      return transaction.$executeRaw(Prisma.sql`
        DELETE FROM research_observations
        WHERE id = ${candidate.id} AND organization_id = ${tenant}
          AND observed_at = ${candidate.observedAt}
          AND ${amazonProviderSql(Prisma.raw("provider_key"))}
      `);
    }
    case "PRODUCT_RESEARCH_ITEM":
      return transaction.$executeRaw(Prisma.sql`
        DELETE FROM product_research_run_items item
        USING product_research_runs run
        WHERE item.id = ${candidate.id}
          AND item.organization_id = ${tenant}
          AND run.id = item.run_id
          AND run.organization_id = item.organization_id
          AND ${amazonProviderSql(Prisma.raw("run.provider_key"))}
          AND item.observed_at = ${candidate.observedAt}
      `);
    case "MARKETPLACE_PARTICIPATION":
      return transaction.$executeRaw(Prisma.sql`
        DELETE FROM provider_connection_marketplaces marketplace
        USING provider_connections connection
        WHERE marketplace.id = ${candidate.id}
          AND marketplace.organization_id = ${tenant}
          AND connection.id = marketplace.provider_connection_id
          AND connection.organization_id = marketplace.organization_id
          AND connection.provider = 'AMAZON_SP_API'
          AND marketplace.observed_at = ${candidate.observedAt}
      `);
    case "HISTORICAL_POINT":
      return transaction.$executeRaw(Prisma.sql`
        DELETE FROM historical_metric_points point
        USING historical_metric_series series
        WHERE point.id = ${candidate.id}
          AND point.organization_id = ${tenant}
          AND series.id = point.series_id
          AND series.organization_id = point.organization_id
          AND ${amazonProviderSql(Prisma.raw("series.provider_key"))}
          AND point.metric_at = ${candidate.observedAt}
      `);
    case "PROJECT_EVIDENCE": {
      await transaction.decisionMemoSource.deleteMany({
        where: {
          organizationId: tenant,
          evidenceReferenceId: candidate.id,
        },
      });
      return transaction.projectEvidenceReference
        .deleteMany({ where: { id: candidate.id, organizationId: tenant } })
        .then(({ count }) => count);
    }
    case "DECISION_SOURCE": {
      const source = await transaction.decisionMemoSource.findFirst({
        where: { id: candidate.id, organizationId: tenant },
        select: { decisionMemoId: true },
      });
      if (!source) return 0;
      await transaction.decisionMemo.updateMany({
        where: { id: source.decisionMemoId, organizationId: tenant },
        data: {
          sourceSnapshot: {
            amazonInformation: "REMOVED_BY_RETENTION",
          },
        },
      });
      return transaction.decisionMemoSource
        .deleteMany({ where: { id: candidate.id, organizationId: tenant } })
        .then(({ count }) => count);
    }
  }
}

/** Deletes only records whose referenced object was already removed (or which
 * had no object). This ordering prevents dangling private objects. */
export async function deleteAmazonInformationCandidates(input: {
  organizationId: string;
  candidates: readonly AmazonInformationCandidate[];
  objectDeletionConfirmedIds: ReadonlySet<string>;
  now?: Date;
  reason: "RETENTION_EXPIRY" | "DELETION_REQUEST" | "TOMBSTONE_REPLAY";
}) {
  if (input.candidates.length > RETENTION_BATCH_SIZE)
    throw new Error("AMAZON_RETENTION_BATCH_LIMIT_INVALID");
  if (
    input.candidates.some(
      (candidate) => candidate.organizationId !== input.organizationId,
    )
  )
    throw new Error("AMAZON_RETENTION_TENANT_MISMATCH");
  const eligible = input.candidates.filter(
    (candidate) =>
      !candidate.objectReference ||
      input.objectDeletionConfirmedIds.has(candidate.id),
  );
  const counts = emptyCounts();
  if (!eligible.length) return counts;
  const now = input.now ?? new Date();
  return db.$transaction(async (transaction) => {
    for (const candidate of eligible) {
      const deleted = await deleteCandidate(transaction, candidate);
      counts[candidate.kind] += deleted;
    }
    const fingerprint = createHash("sha256")
      .update(
        eligible
          .map(({ id, kind }) => `${kind}:${id}`)
          .sort()
          .join("|"),
      )
      .digest("hex")
      .slice(0, 24);
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "AMAZON_INFORMATION",
        entityId: "retention-batch",
        eventType: "AMAZON_INFORMATION_DELETED",
        idempotencyKey: `amazon-retention:${input.reason}:${fingerprint}`,
        payload: {
          reason: input.reason,
          deletedAt: now.toISOString(),
          counts,
          // No source values, object names, record IDs, or credentials.
          payloadRetained: false,
        },
      },
    });
    return counts;
  });
}

export async function minimizeExpiredGlobalAmazonCatalogProducts(
  now = new Date(),
  limit = RETENTION_BATCH_SIZE,
) {
  assertBatchLimit(limit);
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT product.id
    FROM catalog_products product
    WHERE ${amazonProviderSql(Prisma.raw("product.provider"))}
      AND product.observed_at + INTERVAL '18 months' <= ${now}
      AND (product.raw_payload IS NOT NULL OR product.identity_projection IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM product_research_run_items item
        WHERE item.catalog_product_id = product.id
          AND item.observed_at + INTERVAL '18 months' > ${now}
      )
    ORDER BY product.observed_at ASC, product.id ASC
    LIMIT ${limit}
  `);
  if (!rows.length) return 0;
  return db.$executeRaw(Prisma.sql`
    UPDATE catalog_products product
    SET raw_payload = NULL,
        identity_projection = NULL,
        response_completeness = NULL,
        request_lineage = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE product.id IN (${Prisma.join(rows.map(({ id }) => id))})
      AND ${amazonProviderSql(Prisma.raw("product.provider"))}
      AND product.observed_at + INTERVAL '18 months' <= ${now}
      AND NOT EXISTS (
        SELECT 1 FROM product_research_run_items item
        WHERE item.catalog_product_id = product.id
          AND item.observed_at + INTERVAL '18 months' > ${now}
      )
  `);
}

export async function createAmazonDeletionRequest(input: {
  organizationId: string;
  requestedByUserId: string;
  reason:
    | "AMAZON_NOTICE"
    | "AUTHORIZATION_REVOKED"
    | "ENTITLEMENT_LOST"
    | "SERVICE_TERMINATION"
    | "OPERATOR_POLICY";
  marketplaceId?: string;
  requestedAt?: Date;
  idempotencyKey: string;
}) {
  const requestedAt = input.requestedAt ?? new Date();
  const deadlineAt = amazonDeletionDeadline(requestedAt);
  return db.$transaction(async (transaction) => {
    const existing = await transaction.amazonDeletionRequest.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) return { request: existing, duplicate: true };
    const request = await transaction.amazonDeletionRequest.create({
      data: {
        organizationId: input.organizationId,
        requestedByUserId: input.requestedByUserId,
        reason: input.reason,
        marketplaceId: input.marketplaceId ?? null,
        requestedAt,
        deadlineAt,
        cutoffAt: requestedAt,
        idempotencyKey: input.idempotencyKey,
      },
    });
    const connectionWhere = {
      organizationId: input.organizationId,
      provider: "AMAZON_SP_API" as const,
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
    };
    const connections = await transaction.providerConnection.findMany({
      where: connectionWhere,
      select: { id: true },
    });
    const connectionIds = connections.map(({ id }) => id);
    await transaction.providerConnection.updateMany({
      where: connectionWhere,
      data: {
        status: "REVOKED",
        revokedAt: requestedAt,
        encryptedRefreshToken: null,
        encryptionNonce: null,
        encryptionTag: null,
        encryptionKeyVersion: null,
        lastErrorCode: "AMAZON_DELETION_SAFE_STATE",
      },
    });
    await transaction.providerCredential.deleteMany({
      where: {
        organizationId: input.organizationId,
        providerKey: { in: ["amazon-sp-api", "amazon_sp_api"] },
      },
    });
    await transaction.providerEntitlement.updateMany({
      where: {
        organizationId: input.organizationId,
        providerKey: { in: ["amazon-sp-api", "amazon_sp_api"] },
        ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
      },
      data: {
        state: "UNAUTHORIZED",
        reasonCode: "CONNECTION_NOT_AUTHORIZED",
        checkedAt: requestedAt,
      },
    });
    await transaction.providerRequestLease.updateMany({
      where: {
        organizationId: input.organizationId,
        providerKey: { in: ["amazon-sp-api", "amazon_sp_api"] },
        state: "ACTIVE",
      },
      data: { state: "RELEASED", completedAt: requestedAt },
    });
    if (connectionIds.length) {
      await transaction.providerConnectionJob.updateMany({
        where: {
          organizationId: input.organizationId,
          providerConnectionId: { in: connectionIds },
          status: { in: ["PENDING", "RUNNING", "FAILED_RETRYABLE"] },
        },
        data: {
          status: "FAILED_FINAL",
          resultCode: "AMAZON_DELETION_SAFE_STATE",
          completedAt: requestedAt,
        },
      });
      await transaction.enrichmentRun.updateMany({
        where: {
          organizationId: input.organizationId,
          providerConnectionId: { in: connectionIds },
          status: { in: ["PENDING", "RUNNING", "FAILED_RETRYABLE"] },
        },
        data: { status: "FAILED_FINAL", completedAt: requestedAt },
      });
    }
    await transaction.productResearchRun.updateMany({
      where: {
        organizationId: input.organizationId,
        providerKey: { in: ["amazon-sp-api", "amazon_sp_api"] },
        status: { in: ["PENDING", "RUNNING", "FAILED_RETRYABLE"] },
      },
      data: {
        status: "FAILED_FINAL",
        errorCode: "AMAZON_DELETION_SAFE_STATE",
        completedAt: requestedAt,
      },
    });
    const safe = await transaction.amazonDeletionRequest.update({
      where: { id: request.id },
      data: { status: "SAFE_STATE", safeStateAt: requestedAt },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "AMAZON_DELETION_REQUEST",
        entityId: request.id,
        eventType: "AMAZON_DELETION_REQUESTED",
        idempotencyKey: `amazon-deletion-request:${request.id}`,
        payload: {
          reason: input.reason,
          requestedAt: requestedAt.toISOString(),
          deadlineAt: deadlineAt.toISOString(),
          marketplaceScoped: Boolean(input.marketplaceId),
        },
      },
    });
    return { request: safe, duplicate: false };
  });
}

export async function listPendingAmazonDeletionScopes(limit = 25) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("AMAZON_DELETION_REQUEST_LIMIT_INVALID");
  const requests = await db.amazonDeletionRequest.findMany({
    where: { status: { in: ["SAFE_STATE", "PROCESSING", "PARTIAL_FAILURE"] } },
    orderBy: [{ deadlineAt: "asc" }, { requestedAt: "asc" }],
    take: limit,
  });
  const tombstones = await db.amazonDeletionTombstone.findMany({
    orderBy: { lastReappliedAt: "asc" },
    take: limit,
  });
  return { requests, tombstones };
}

export async function markAmazonDeletionAttempt(input: {
  requestId: string;
  status: "PROCESSING" | "PARTIAL_FAILURE" | "FAILED";
  failureCode?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.amazonDeletionRequest.update({
    where: { id: input.requestId },
    data: {
      status: input.status,
      attemptCount: { increment: 1 },
      startedAt: now,
      failureCode: input.failureCode ?? null,
    },
  });
}

export async function completeAmazonDeletionRequest(input: {
  requestId: string;
  organizationId: string;
  deletedCounts: AmazonDeletionCounts;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const scopeHash = createHash("sha256")
    .update(`${input.organizationId}:${input.requestId}:amazon-sp-api`)
    .digest("hex");
  return db.$transaction(async (transaction) => {
    const request = await transaction.amazonDeletionRequest.findFirst({
      where: { id: input.requestId, organizationId: input.organizationId },
    });
    if (!request) throw new Error("AMAZON_DELETION_REQUEST_NOT_FOUND");
    const completed = await transaction.amazonDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        failureCode: null,
        deletedCounts: input.deletedCounts,
      },
    });
    await transaction.amazonDeletionTombstone.upsert({
      where: { deletionRequestId: request.id },
      create: {
        id: randomUUID(),
        organizationId: request.organizationId,
        deletionRequestId: request.id,
        providerKey: request.providerKey,
        marketplaceId: request.marketplaceId,
        cutoffAt: request.cutoffAt,
        scopeHash,
        deletedAt: now,
        lastReappliedAt: now,
      },
      update: { lastReappliedAt: now },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: request.organizationId,
        entityType: "AMAZON_DELETION_REQUEST",
        entityId: request.id,
        eventType: "AMAZON_DELETION_COMPLETED",
        idempotencyKey: `amazon-deletion-completed:${request.id}`,
        payload: {
          completedAt: now.toISOString(),
          deletedCounts: input.deletedCounts,
          tombstoneScopeHash: scopeHash,
          payloadRetained: false,
        },
      },
    });
    return completed;
  });
}

export async function markAmazonTombstoneReapplied(
  tombstoneId: string,
  now = new Date(),
) {
  return db.amazonDeletionTombstone.update({
    where: { id: tombstoneId },
    data: { lastReappliedAt: now },
  });
}

export async function listOrganizationsWithAmazonInformation(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
    throw new Error("AMAZON_RETENTION_ORGANIZATION_LIMIT_INVALID");
  const rows = await db.$queryRaw<Array<{ organizationId: string }>>(
    Prisma.sql`
      SELECT organization_id AS "organizationId"
      FROM (
        SELECT organization_id FROM provider_cache_entries
        WHERE ${amazonProviderSql(Prisma.raw("provider_key"))}
        UNION
        SELECT organization_id FROM research_observations
        WHERE ${amazonProviderSql(Prisma.raw("provider_key"))}
        UNION
        SELECT run.organization_id
        FROM provider_observations observation
        JOIN enrichment_items item ON item.id = observation.enrichment_item_id
        JOIN enrichment_runs run ON run.id = item.enrichment_run_id
        WHERE observation.provider = 'AMAZON_SP_API'
        UNION
        SELECT organization_id FROM amazon_deletion_requests
        WHERE status IN ('SAFE_STATE', 'PROCESSING', 'PARTIAL_FAILURE')
      ) organizations
      ORDER BY organization_id
      LIMIT ${limit}
    `,
  );
  return rows.map(({ organizationId }) => organizationId);
}

export async function recordAmazonRetentionRun(input: {
  organizationId: string;
  mode: "RETENTION_EXPIRY" | "DELETION_REQUEST" | "TOMBSTONE_REPLAY";
  cutoffAt: Date;
  status: "COMPLETED" | "PARTIAL_FAILURE" | "FAILED";
  deletedCounts: AmazonDeletionCounts;
  failureCode?: string;
  startedAt: Date;
  completedAt?: Date;
}) {
  return db.amazonRetentionRun.create({
    data: {
      organizationId: input.organizationId,
      mode: input.mode,
      cutoffAt: input.cutoffAt,
      status: input.status,
      deletedCounts: input.deletedCounts,
      failureCode: input.failureCode ?? null,
      startedAt: input.startedAt,
      completedAt: input.completedAt ?? new Date(),
    },
  });
}

export async function getAmazonRetentionDashboard(
  organizationId: string,
  now = new Date(),
) {
  const [oldestRows, nearingRows, lastRun, failedRequests, retentionRuns] =
    await Promise.all([
      db.$queryRaw<Array<{ oldest: Date | null }>>(Prisma.sql`
        SELECT MIN(observed_at) AS oldest FROM (
          SELECT observed_at FROM provider_cache_entries
          WHERE organization_id = ${organizationId}
            AND ${amazonProviderSql(Prisma.raw("provider_key"))}
          UNION ALL
          SELECT observed_at FROM research_observations
          WHERE organization_id = ${organizationId}
            AND ${amazonProviderSql(Prisma.raw("provider_key"))}
          UNION ALL
          SELECT item.observed_at
          FROM product_research_run_items item
          JOIN product_research_runs run ON run.id = item.run_id
          WHERE item.organization_id = ${organizationId}
            AND run.organization_id = item.organization_id
            AND ${amazonProviderSql(Prisma.raw("run.provider_key"))}
          UNION ALL
          SELECT observation.observed_at
          FROM provider_observations observation
          JOIN enrichment_items item ON item.id = observation.enrichment_item_id
          JOIN enrichment_runs run ON run.id = item.enrichment_run_id
          WHERE run.organization_id = ${organizationId}
            AND observation.provider = 'AMAZON_SP_API'
          UNION ALL
          SELECT marketplace.observed_at
          FROM provider_connection_marketplaces marketplace
          JOIN provider_connections connection
            ON connection.id = marketplace.provider_connection_id
          WHERE marketplace.organization_id = ${organizationId}
            AND connection.organization_id = marketplace.organization_id
            AND connection.provider = 'AMAZON_SP_API'
          UNION ALL
          SELECT point.metric_at
          FROM historical_metric_points point
          JOIN historical_metric_series series
            ON series.id = point.series_id
           AND series.organization_id = point.organization_id
          WHERE point.organization_id = ${organizationId}
            AND ${amazonProviderSql(Prisma.raw("series.provider_key"))}
          UNION ALL
          SELECT COALESCE(evidence.observed_at, evidence.created_at)
          FROM project_evidence_references evidence
          WHERE evidence.organization_id = ${organizationId}
            AND (
              lower(evidence.evidence_type) LIKE '%amazon%'
              OR lower(evidence.source_description) LIKE '%amazon%'
              OR lower(evidence.source_reference) LIKE '%amazon%'
            )
        ) observations
      `),
      db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT LEAST(retain_until, observed_at + INTERVAL '18 months') AS expiry
          FROM provider_cache_entries
          WHERE organization_id = ${organizationId}
            AND ${amazonProviderSql(Prisma.raw("provider_key"))}
          UNION ALL
          SELECT observed_at + INTERVAL '18 months'
          FROM research_observations
          WHERE organization_id = ${organizationId}
            AND ${amazonProviderSql(Prisma.raw("provider_key"))}
          UNION ALL
          SELECT item.observed_at + INTERVAL '18 months'
          FROM product_research_run_items item
          JOIN product_research_runs run ON run.id = item.run_id
          WHERE item.organization_id = ${organizationId}
            AND run.organization_id = item.organization_id
            AND ${amazonProviderSql(Prisma.raw("run.provider_key"))}
          UNION ALL
          SELECT observation.observed_at + INTERVAL '18 months'
          FROM provider_observations observation
          JOIN enrichment_items item ON item.id = observation.enrichment_item_id
          JOIN enrichment_runs run ON run.id = item.enrichment_run_id
          WHERE run.organization_id = ${organizationId}
            AND observation.provider = 'AMAZON_SP_API'
          UNION ALL
          SELECT marketplace.observed_at + INTERVAL '18 months'
          FROM provider_connection_marketplaces marketplace
          JOIN provider_connections connection
            ON connection.id = marketplace.provider_connection_id
          WHERE marketplace.organization_id = ${organizationId}
            AND connection.organization_id = marketplace.organization_id
            AND connection.provider = 'AMAZON_SP_API'
          UNION ALL
          SELECT LEAST(
            point.metric_at + INTERVAL '18 months',
            point.metric_at + (series.retention_days * INTERVAL '1 day')
          )
          FROM historical_metric_points point
          JOIN historical_metric_series series
            ON series.id = point.series_id
           AND series.organization_id = point.organization_id
          WHERE point.organization_id = ${organizationId}
            AND ${amazonProviderSql(Prisma.raw("series.provider_key"))}
        ) records
        WHERE expiry > ${now}
          AND expiry <= ${new Date(now.valueOf() + 30 * 86_400_000)}
      `),
      db.amazonRetentionRun.findFirst({
        where: { organizationId },
        orderBy: { startedAt: "desc" },
      }),
      db.amazonDeletionRequest.count({
        where: {
          organizationId,
          status: { in: ["PARTIAL_FAILURE", "FAILED"] },
        },
      }),
      db.amazonRetentionRun.findMany({
        where: {
          organizationId,
          status: { in: ["COMPLETED", "PARTIAL_FAILURE"] },
        },
        select: { deletedCounts: true },
      }),
    ]);
  const deletedRecords = retentionRuns.reduce<number>((sum, request) => {
    if (!request.deletedCounts || Array.isArray(request.deletedCounts))
      return sum;
    return (
      sum +
      Object.values(
        request.deletedCounts as Record<string, unknown>,
      ).reduce<number>(
        (inner, value) => inner + (typeof value === "number" ? value : 0),
        0,
      )
    );
  }, 0);
  return {
    policy: {
      rizpointMaximumCalendarMonths: AMAZON_INFORMATION_MAX_RETENTION_MONTHS,
      amazonEventDeletionDeadlineDays: 30,
      legalHoldsSupported: false,
      shorterContractualRetentionWins: true,
    },
    oldestObservationAt: oldestRows[0]?.oldest?.toISOString() ?? null,
    nearingExpiryCount: Number(nearingRows[0]?.count ?? 0n),
    deletedRecords,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          startedAt: lastRun.startedAt.toISOString(),
          completedAt: lastRun.completedAt?.toISOString() ?? null,
          failureCode: lastRun.failureCode,
        }
      : null,
    nextScheduledRunAt: new Date(
      now.valueOf() + 6 * 60 * 60 * 1_000,
    ).toISOString(),
    failedDeletionJobs: failedRequests,
  };
}
