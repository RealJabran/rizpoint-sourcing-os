import { createHash } from "node:crypto";
import type { CatalogProduct } from "@rizpoint/provider-contracts";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import { ensureMockAmazonConnection } from "../repositories.js";

const ASIN = /^B[A-Z0-9]{9}$/;
const IDENTIFIER = /^\d{8,14}$/;

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type ProductResearchQueryType =
  "ASIN" | "UPC" | "EAN" | "GTIN" | "KEYWORD";

export type QueueProductResearchInput = {
  organizationId: string;
  marketplaceId: string;
  kind: "PRODUCT_LOOKUP" | "CATALOG_SEARCH";
  queryType: ProductResearchQueryType;
  queryText: string;
  requestedLimit?: number;
  salePrice?: string;
  currency?: string;
  forceRefresh?: boolean;
  idempotencyKey: string;
};

function normalizeQuery(type: ProductResearchQueryType, query: string) {
  const trimmed = query.trim();
  return type === "KEYWORD"
    ? trimmed.normalize("NFC").replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : trimmed.toUpperCase();
}

function validateQuery(type: ProductResearchQueryType, query: string) {
  if (type === "KEYWORD") {
    if (query.length < 2 || query.length > 200)
      throw new Error("CATALOG_KEYWORD_INVALID");
    return;
  }
  if (type === "ASIN" ? !ASIN.test(query) : !IDENTIFIER.test(query))
    throw new Error("PRODUCT_IDENTIFIER_INVALID");
}

/** Resolve live/mock at queue time so a queued job cannot be presented as live
 * merely because a deployment-wide flag is set. The worker resolves again and
 * refuses any mismatch before provider access. */
async function researchRuntime(organizationId: string, marketplaceId: string) {
  const live = await db.providerConnection.findFirst({
    where: {
      organizationId,
      provider: "AMAZON_SP_API",
      status: "ACTIVE",
      OR: [
        { marketplaceId },
        {
          marketplaces: {
            some: { marketplaceId, isParticipating: true },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (live)
    return { providerKey: "amazon-sp-api", providerMode: "LIVE" as const };
  const anyLive = await db.providerConnection.findFirst({
    where: { organizationId, provider: "AMAZON_SP_API" },
    select: { id: true },
  });
  if (anyLive) throw new Error("AMAZON_MARKETPLACE_NOT_CONNECTED");
  const demoAllowed =
    process.env.PHASE_ZERO_DEMO_MODE === "true" &&
    (process.env.PROVIDER_MODE ?? "mock") === "mock";
  if (!demoAllowed) throw new Error("AMAZON_NOT_CONNECTED");
  const mock = await ensureMockAmazonConnection(organizationId);
  if (mock.marketplaceId !== marketplaceId)
    throw new Error("AMAZON_MARKETPLACE_NOT_CONNECTED");
  return { providerKey: "mock-amazon", providerMode: "MOCK" as const };
}

export async function queueProductResearchRun(
  input: QueueProductResearchInput,
) {
  const requestedLimit = input.requestedLimit ?? 20;
  if (
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 20
  )
    throw new Error("CATALOG_RESULT_LIMIT_INVALID");
  if ((input.kind === "CATALOG_SEARCH") !== (input.queryType === "KEYWORD"))
    throw new Error("PRODUCT_RESEARCH_QUERY_KIND_INVALID");
  const normalizedQuery = normalizeQuery(input.queryType, input.queryText);
  validateQuery(input.queryType, normalizedQuery);
  if (
    input.salePrice !== undefined &&
    !/^\d+(\.\d{1,4})?$/.test(input.salePrice)
  )
    throw new Error("SALE_PRICE_INVALID");
  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency))
    throw new Error("CURRENCY_INVALID");
  const runtime = await researchRuntime(
    input.organizationId,
    input.marketplaceId,
  );
  const identity = {
    kind: input.kind,
    marketplaceId: input.marketplaceId,
    queryType: input.queryType,
    normalizedQuery,
    requestedLimit,
    salePrice: input.salePrice ?? null,
    currency: input.currency ?? null,
    forceRefresh: input.forceRefresh ?? false,
    ...runtime,
  };
  const requestHash = hash(identity);
  return db.$transaction(async (transaction) => {
    const existing = await transaction.productResearchRun.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new Error("PRODUCT_RESEARCH_IDEMPOTENCY_CONFLICT");
      return { ...existing, duplicate: true };
    }
    const run = await transaction.productResearchRun.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        marketplaceId: input.marketplaceId,
        providerKey: runtime.providerKey,
        providerMode: runtime.providerMode,
        queryType: input.queryType,
        queryText: input.queryText.trim(),
        normalizedQuery,
        requestedLimit,
        ...(input.salePrice ? { salePrice: input.salePrice } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
        forceRefresh: input.forceRefresh ?? false,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        productResearchRunId: run.id,
        eventType: `product-research.requested.${run.id}`,
        payload: { kind: "PRODUCT_RESEARCH", researchRunId: run.id },
      },
    });
    return { ...run, duplicate: false };
  });
}

export async function claimProductResearchRun(runId: string) {
  const claimed = await db.productResearchRun.updateMany({
    where: {
      id: runId,
      status: { in: ["PENDING", "FAILED_RETRYABLE"] },
    },
    data: {
      status: "RUNNING",
      attemptCount: { increment: 1 },
      errorCode: null,
      startedAt: new Date(),
      completedAt: null,
    },
  });
  if (!claimed.count) return null;
  return db.productResearchRun.findUnique({ where: { id: runId } });
}

export type PersistedResearchItem = {
  product: CatalogProduct;
  evidence: unknown;
  source: string;
  dataOrigin:
    | "LIVE_AMAZON"
    | "STORED_AMAZON"
    | "LICENSED_PROVIDER"
    | "USER_INPUT"
    | "DERIVED"
    | "MOCK";
  observedAt: Date;
  freshUntil?: Date;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  status?: "COMPLETED" | "PARTIAL_SUCCESS";
};

function identityProjection(product: CatalogProduct) {
  return {
    manufacturer: product.manufacturer ?? null,
    color: product.color ?? null,
    productTypes: product.productTypes ?? [],
    variationTheme: product.variationTheme ?? null,
    packageHierarchy: product.packageHierarchy ?? [],
    images: product.images ?? [],
    dimensions: product.dimensions ?? null,
    salesRanks: product.salesRanks ?? [],
  };
}

function normalizedCatalogProduct(product: CatalogProduct) {
  const normalized = { ...product };
  delete normalized.rawProviderObservation;
  return normalized;
}

export async function completeProductResearchRun(input: {
  runId: string;
  organizationId: string;
  items: readonly PersistedResearchItem[];
}) {
  return db.$transaction(async (transaction) => {
    const run = await transaction.productResearchRun.findFirst({
      where: {
        id: input.runId,
        organizationId: input.organizationId,
        status: "RUNNING",
      },
    });
    if (!run) return null;
    await transaction.productResearchRunItem.deleteMany({
      where: { runId: run.id, organizationId: input.organizationId },
    });
    let partial = false;
    for (const [ordinal, item] of input.items.entries()) {
      const reference =
        item.product.provenance.providerReference ?? item.product.asin;
      const product = await transaction.catalogProduct.upsert({
        where: {
          provider_providerReference: {
            provider: item.product.provenance.provider,
            providerReference: reference,
          },
        },
        create: {
          provider: item.product.provenance.provider,
          providerReference: reference,
          asin: item.product.asin,
          title: item.product.title,
          brand: item.product.brand ?? null,
          model: item.product.model ?? null,
          mpn: item.product.mpn ?? null,
          sizeText: item.product.sizeText ?? null,
          packCount: item.product.packCount ?? null,
          variation: item.product.variation ?? null,
          marketplaceId: run.marketplaceId,
          responseCompleteness:
            item.product.provenance.responseCompleteness ?? item.completeness,
          requestLineage: item.product.provenance.requestId ?? null,
          identityProjection: identityProjection(
            item.product,
          ) as Prisma.InputJsonValue,
          observedAt: item.observedAt,
          freshnessState: item.freshnessState,
          rawPayload: {
            normalized: normalizedCatalogProduct(item.product),
            rawProviderObservation: item.product.rawProviderObservation ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
        update: {
          asin: item.product.asin,
          title: item.product.title,
          brand: item.product.brand ?? null,
          model: item.product.model ?? null,
          mpn: item.product.mpn ?? null,
          sizeText: item.product.sizeText ?? null,
          packCount: item.product.packCount ?? null,
          variation: item.product.variation ?? null,
          marketplaceId: run.marketplaceId,
          responseCompleteness:
            item.product.provenance.responseCompleteness ?? item.completeness,
          requestLineage: item.product.provenance.requestId ?? null,
          identityProjection: identityProjection(
            item.product,
          ) as Prisma.InputJsonValue,
          observedAt: item.observedAt,
          freshnessState: item.freshnessState,
          rawPayload: {
            normalized: normalizedCatalogProduct(item.product),
            rawProviderObservation: item.product.rawProviderObservation ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await transaction.productIdentifier.deleteMany({
        where: { catalogProductId: product.id },
      });
      if (item.product.identifiers.length)
        await transaction.productIdentifier.createMany({
          data: item.product.identifiers.map((identifier) => ({
            catalogProductId: product.id,
            type: identifier.type,
            value: identifier.value,
          })),
        });
      const itemStatus = item.status ?? "COMPLETED";
      partial ||=
        itemStatus === "PARTIAL_SUCCESS" || item.completeness !== "COMPLETE";
      await transaction.productResearchRunItem.create({
        data: {
          organizationId: input.organizationId,
          runId: run.id,
          catalogProductId: product.id,
          ordinal,
          status: itemStatus,
          evidence: item.evidence as Prisma.InputJsonValue,
          source: item.source,
          dataOrigin: item.dataOrigin,
          observedAt: item.observedAt,
          ...(item.freshUntil ? { freshUntil: item.freshUntil } : {}),
          freshnessState: item.freshnessState,
          completeness: item.completeness,
        },
      });
    }
    return transaction.productResearchRun.update({
      where: { id: run.id },
      data: {
        status: partial ? "PARTIAL_SUCCESS" : "COMPLETED",
        resultCount: input.items.length,
        completedAt: new Date(),
      },
    });
  });
}

export async function failProductResearchRun(input: {
  runId: string;
  final: boolean;
  errorCode: string;
}) {
  return db.productResearchRun.updateMany({
    where: { id: input.runId, status: "RUNNING" },
    data: {
      status: input.final ? "FAILED_FINAL" : "FAILED_RETRYABLE",
      errorCode: input.errorCode,
      completedAt: input.final ? new Date() : null,
    },
  });
}

function productProjection(product: {
  id: string;
  asin: string | null;
  title: string;
  brand: string | null;
  marketplaceId: string | null;
  identityProjection: Prisma.JsonValue | null;
  identifiers: Array<{ type: string; value: string }>;
}) {
  return {
    id: product.id,
    asin: product.asin,
    title: product.title,
    brand: product.brand,
    marketplaceId: product.marketplaceId,
    identity: product.identityProjection,
    identifiers: product.identifiers,
  };
}

/** Browser-safe projection: raw provider payloads and credentials are never selected. */
export async function getProductResearchRun(input: {
  organizationId: string;
  runId: string;
  offset?: number;
  limit?: number;
}) {
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(20, Math.max(1, input.limit ?? 20));
  const run = await db.productResearchRun.findFirst({
    where: { id: input.runId, organizationId: input.organizationId },
    include: {
      items: {
        orderBy: [{ ordinal: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
        include: {
          catalogProduct: {
            select: {
              id: true,
              asin: true,
              title: true,
              brand: true,
              marketplaceId: true,
              identityProjection: true,
              identifiers: { select: { type: true, value: true } },
            },
          },
        },
      },
    },
  });
  if (!run) return null;
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    marketplaceId: run.marketplaceId,
    providerKey: run.providerKey,
    providerMode: run.providerMode,
    queryType: run.queryType,
    queryText: run.queryText,
    forceRefresh: run.forceRefresh,
    resultCount: run.resultCount,
    errorCode: run.errorCode,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    items: run.items.map((item) => ({
      id: item.id,
      status: item.status,
      product: productProjection(item.catalogProduct),
      evidence: item.evidence,
      source: item.source,
      dataOrigin: item.dataOrigin,
      observedAt: item.observedAt.toISOString(),
      freshUntil: item.freshUntil?.toISOString() ?? null,
      freshnessState: item.freshnessState,
      completeness: item.completeness,
    })),
  };
}

export async function listRecentProductResearchRuns(input: {
  organizationId: string;
  marketplaceId?: string;
  limit?: number;
}) {
  return db.productResearchRun.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(20, Math.max(1, input.limit ?? 10)),
    select: {
      id: true,
      kind: true,
      status: true,
      marketplaceId: true,
      queryType: true,
      queryText: true,
      resultCount: true,
      providerMode: true,
      errorCode: true,
      createdAt: true,
      completedAt: true,
    },
  });
}
