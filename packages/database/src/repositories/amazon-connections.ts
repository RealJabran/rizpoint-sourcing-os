import { randomUUID } from "node:crypto";
import type { ProviderCapability } from "@rizpoint/provider-contracts";
import { db } from "../client.js";

const AMAZON_CAPABILITIES: readonly ProviderCapability[] = [
  "CATALOG",
  "COMPETITIVE_OFFERS",
  "FEES",
  "RESTRICTIONS",
];

type MarketplaceParticipation = {
  marketplaceId: string;
  name: string;
  countryCode?: string;
  domainName?: string;
  defaultCurrencyCode?: string;
  defaultLanguageCode?: string;
  isParticipating: boolean;
  hasSuspendedListings: boolean;
};

export class AmazonConnectionError extends Error {
  constructor(
    readonly code:
      | "CONNECTION_NOT_FOUND"
      | "MARKETPLACE_NOT_AVAILABLE"
      | "OAUTH_STATE_INVALID"
      | "OAUTH_STATE_EXPIRED"
      | "OAUTH_STATE_REPLAYED"
      | "OAUTH_SELLER_MISMATCH",
  ) {
    super(code);
  }
}

export async function continueAmazonAuthorizationState(input: {
  organizationId: string;
  stateHash: string;
  sellerId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const state = await db.providerAuthorizationState.findFirst({
    where: {
      organizationId: input.organizationId,
      provider: "AMAZON_SP_API",
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!state) throw new AmazonConnectionError("OAUTH_STATE_INVALID");
  return db.providerAuthorizationState.update({
    where: { id: state.id },
    data: { stateHash: input.stateHash, sellerId: input.sellerId },
  });
}

export async function createAmazonAuthorizationState(input: {
  organizationId: string;
  stateHash: string;
  marketplaceId: string;
  region: string;
  returnPath: string;
  expiresAt: Date;
}) {
  const connection = await db.providerConnection.findFirst({
    where: {
      organizationId: input.organizationId,
      provider: "AMAZON_SP_API",
      status: { not: "REVOKED" },
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  return db.$transaction(async (transaction) => {
    const state = await transaction.providerAuthorizationState.create({
      data: {
        organizationId: input.organizationId,
        providerConnectionId: connection?.id ?? null,
        provider: "AMAZON_SP_API",
        stateHash: input.stateHash,
        marketplaceId: input.marketplaceId,
        region: input.region,
        returnPath: input.returnPath,
        expiresAt: input.expiresAt,
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "ProviderAuthorizationState",
        entityId: state.id,
        eventType: "amazon.authorization_started",
        idempotencyKey: `amazon-oauth-start:${state.id}`,
        payload: {
          marketplaceId: input.marketplaceId,
          region: input.region,
          expiresAt: input.expiresAt.toISOString(),
        },
      },
    });
    return state;
  });
}

export async function consumeAmazonAuthorizationState(input: {
  stateHash: string;
  encryptedOauthCode: string;
  oauthCodeKeyVersion: number;
  sellerId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (transaction) => {
    const state = await transaction.providerAuthorizationState.findUnique({
      where: { stateHash: input.stateHash },
    });
    if (!state) throw new AmazonConnectionError("OAUTH_STATE_INVALID");
    if (state.consumedAt)
      throw new AmazonConnectionError("OAUTH_STATE_REPLAYED");
    if (state.expiresAt <= now)
      throw new AmazonConnectionError("OAUTH_STATE_EXPIRED");
    if (state.sellerId && state.sellerId !== input.sellerId)
      throw new AmazonConnectionError("OAUTH_SELLER_MISMATCH");
    const consumed = await transaction.providerAuthorizationState.updateMany({
      where: { id: state.id, consumedAt: null, expiresAt: { gt: now } },
      data: {
        consumedAt: now,
        callbackReceivedAt: now,
        encryptedOauthCode: input.encryptedOauthCode,
        oauthCodeKeyVersion: input.oauthCodeKeyVersion,
        sellerId: input.sellerId,
        failureCode: null,
      },
    });
    if (consumed.count !== 1)
      throw new AmazonConnectionError("OAUTH_STATE_REPLAYED");
    const job = await transaction.providerConnectionJob.create({
      data: {
        organizationId: state.organizationId,
        authorizationStateId: state.id,
        kind: "OAUTH_COMPLETE",
        idempotencyKey: `amazon-oauth:${state.id}`,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        organizationId: state.organizationId,
        providerConnectionJobId: job.id,
        eventType: `provider-connection.requested.${job.id}`,
        payload: { kind: "PROVIDER_CONNECTION", connectionJobId: job.id },
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: state.organizationId,
        entityType: "ProviderAuthorizationState",
        entityId: state.id,
        eventType: "amazon.authorization_callback_received",
        idempotencyKey: `amazon-oauth-callback:${state.id}`,
        payload: { mode: "OAUTH", region: state.region },
      },
    });
    return { jobId: job.id, returnPath: state.returnPath };
  });
}

export async function failAmazonAuthorizationState(input: {
  stateHash: string;
  failureCode: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.providerAuthorizationState.updateMany({
    where: {
      stateHash: input.stateHash,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      consumedAt: now,
      callbackReceivedAt: now,
      failureCode: input.failureCode,
    },
  });
}

export async function requestAmazonConnectionJob(input: {
  organizationId: string;
  connectionId: string;
  kind: "VALIDATE" | "REFRESH_CAPABILITIES";
  idempotencyKey?: string;
  now?: Date;
}) {
  return db.$transaction(async (transaction) => {
    const connection = await transaction.providerConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
        provider: "AMAZON_SP_API",
        status: { not: "REVOKED" },
      },
      select: { id: true },
    });
    if (!connection) throw new AmazonConnectionError("CONNECTION_NOT_FOUND");
    const now = input.now ?? new Date();
    const cooldownMs =
      input.kind === "REFRESH_CAPABILITIES" ? 15 * 60_000 : 60_000;
    if (!input.idempotencyKey) {
      const recent = await transaction.providerConnectionJob.findFirst({
        where: {
          organizationId: input.organizationId,
          providerConnectionId: connection.id,
          kind: input.kind,
          requestedAt: { gt: new Date(now.getTime() - cooldownMs) },
          status: {
            in: ["PENDING", "RUNNING", "FAILED_RETRYABLE", "COMPLETED"],
          },
        },
        orderBy: { requestedAt: "desc" },
      });
      if (recent) return recent;
    }
    const bucket = Math.floor(now.getTime() / cooldownMs);
    const idempotencyKey =
      input.idempotencyKey ??
      `amazon-${input.kind.toLowerCase()}:${connection.id}:${bucket}`;
    const job = await transaction.providerConnectionJob.upsert({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        providerConnectionId: connection.id,
        kind: input.kind,
        idempotencyKey,
      },
      update: {},
    });
    await transaction.outboxEvent.upsert({
      where: {
        providerConnectionJobId_eventType: {
          providerConnectionJobId: job.id,
          eventType: `provider-connection.requested.${job.id}`,
        },
      },
      create: {
        organizationId: input.organizationId,
        providerConnectionJobId: job.id,
        eventType: `provider-connection.requested.${job.id}`,
        payload: { kind: "PROVIDER_CONNECTION", connectionJobId: job.id },
      },
      update: {},
    });
    return job;
  });
}

/** Select a tiny, tenant-scoped product set for non-destructive capability
 * probes. No provider call is needed to discover these candidates. */
export async function findAmazonCapabilityProbeAsins(input: {
  organizationId: string;
  marketplaceId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 5));
  const asins = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value && /^B[A-Z0-9]{9}$/.test(value) && asins.size < limit)
      asins.add(value);
  };
  const watches = await db.productWatch.findMany({
    where: {
      organizationId: input.organizationId,
      marketplaceId: input.marketplaceId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { catalogProduct: { select: { asin: true } } },
  });
  watches.forEach((item) => add(item.catalogProduct.asin));
  if (asins.size < limit) {
    const projectItems = await db.researchProjectItem.findMany({
      where: {
        organizationId: input.organizationId,
        kind: "PRODUCT",
        catalogProduct: {
          marketplaceId: input.marketplaceId,
          asin: { not: null },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { catalogProduct: { select: { asin: true } } },
    });
    projectItems.forEach((item) => add(item.catalogProduct?.asin));
  }
  if (asins.size < limit) {
    const listingCandidates = await db.listingCandidate.findMany({
      where: {
        organizationId: input.organizationId,
        catalogProduct: {
          marketplaceId: input.marketplaceId,
          asin: { not: null },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { catalogProduct: { select: { asin: true } } },
    });
    listingCandidates.forEach((item) => add(item.catalogProduct.asin));
  }
  return [...asins];
}

export async function persistAmazonMarketplaceParticipations(input: {
  organizationId: string;
  connectionId: string;
  participations: readonly MarketplaceParticipation[];
  observedAt: Date;
  preferredMarketplaceId?: string;
}) {
  return db.$transaction(async (transaction) => {
    const connection = await transaction.providerConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
        provider: "AMAZON_SP_API",
      },
    });
    if (!connection) throw new AmazonConnectionError("CONNECTION_NOT_FOUND");
    const available = input.participations.filter(
      (item) => item.isParticipating,
    );
    const defaultMarketplaceId =
      available.find(
        (item) => item.marketplaceId === input.preferredMarketplaceId,
      )?.marketplaceId ??
      available.find((item) => item.marketplaceId === connection.marketplaceId)
        ?.marketplaceId ??
      available[0]?.marketplaceId;
    await transaction.providerConnectionMarketplace.updateMany({
      where: { providerConnectionId: connection.id },
      data: { isDefault: false },
    });
    for (const item of input.participations) {
      await transaction.providerConnectionMarketplace.upsert({
        where: {
          providerConnectionId_marketplaceId: {
            providerConnectionId: connection.id,
            marketplaceId: item.marketplaceId,
          },
        },
        create: {
          organizationId: input.organizationId,
          providerConnectionId: connection.id,
          marketplaceId: item.marketplaceId,
          name: item.name,
          countryCode: item.countryCode ?? null,
          domainName: item.domainName ?? null,
          defaultCurrencyCode: item.defaultCurrencyCode ?? null,
          defaultLanguageCode: item.defaultLanguageCode ?? null,
          isParticipating: item.isParticipating,
          hasSuspendedListings: item.hasSuspendedListings,
          isDefault: item.marketplaceId === defaultMarketplaceId,
          observedAt: input.observedAt,
        },
        update: {
          name: item.name,
          countryCode: item.countryCode ?? null,
          domainName: item.domainName ?? null,
          defaultCurrencyCode: item.defaultCurrencyCode ?? null,
          defaultLanguageCode: item.defaultLanguageCode ?? null,
          isParticipating: item.isParticipating,
          hasSuspendedListings: item.hasSuspendedListings,
          isDefault: item.marketplaceId === defaultMarketplaceId,
          observedAt: input.observedAt,
        },
      });
      for (const capability of AMAZON_CAPABILITIES) {
        const existing = await transaction.providerEntitlement.findUnique({
          where: {
            organizationId_providerKey_marketplaceId_capability: {
              organizationId: input.organizationId,
              providerKey: "amazon-sp-api",
              marketplaceId: item.marketplaceId,
              capability,
            },
          },
        });
        const resetConnectionBoundary = [
          "MARKETPLACE_NOT_PARTICIPATING",
          "LOCAL_CONNECTION_REVOKED",
          "CONNECTION_NOT_AUTHORIZED",
        ].includes(existing?.reasonCode ?? "");
        const state = item.isParticipating
          ? existing && !resetConnectionBoundary
            ? existing.state
            : ("AUTHORIZED" as const)
          : ("UNAVAILABLE" as const);
        const reasonCode = item.isParticipating
          ? state === "AUTHORIZED"
            ? null
            : (existing?.reasonCode ?? null)
          : "MARKETPLACE_NOT_PARTICIPATING";
        const completeness = item.isParticipating
          ? existing && !resetConnectionBoundary
            ? existing.completeness
            : ("UNKNOWN" as const)
          : ("UNKNOWN" as const);
        await transaction.providerEntitlement.upsert({
          where: {
            organizationId_providerKey_marketplaceId_capability: {
              organizationId: input.organizationId,
              providerKey: "amazon-sp-api",
              marketplaceId: item.marketplaceId,
              capability,
            },
          },
          create: {
            organizationId: input.organizationId,
            providerConnectionId: connection.id,
            providerKey: "amazon-sp-api",
            marketplaceId: item.marketplaceId,
            capability,
            mode: "LIVE",
            state,
            reasonCode,
            completeness,
            checkedAt: input.observedAt,
            lastSuccessAt:
              state === "HEALTHY" ? (existing?.lastSuccessAt ?? null) : null,
          },
          update: {
            providerConnectionId: connection.id,
            mode: "LIVE",
            state,
            reasonCode,
            completeness,
            checkedAt: input.observedAt,
            lastSuccessAt: existing?.lastSuccessAt ?? null,
          },
        });
      }
    }
    return defaultMarketplaceId ?? null;
  });
}

export async function setDefaultAmazonMarketplace(input: {
  organizationId: string;
  connectionId: string;
  marketplaceId: string;
}) {
  return db.$transaction(async (transaction) => {
    const marketplace =
      await transaction.providerConnectionMarketplace.findFirst({
        where: {
          providerConnectionId: input.connectionId,
          organizationId: input.organizationId,
          marketplaceId: input.marketplaceId,
          isParticipating: true,
        },
      });
    if (!marketplace)
      throw new AmazonConnectionError("MARKETPLACE_NOT_AVAILABLE");
    await transaction.providerConnectionMarketplace.updateMany({
      where: {
        providerConnectionId: input.connectionId,
        organizationId: input.organizationId,
      },
      data: { isDefault: false },
    });
    await transaction.providerConnectionMarketplace.update({
      where: { id: marketplace.id },
      data: { isDefault: true },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "ProviderConnection",
        entityId: input.connectionId,
        eventType: "amazon.default_marketplace_changed",
        payload: { marketplaceId: input.marketplaceId },
      },
    });
    return marketplace;
  });
}

export async function disconnectAmazonConnection(input: {
  organizationId: string;
  connectionId: string;
}) {
  return db.$transaction(async (transaction) => {
    const updated = await transaction.providerConnection.updateMany({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
        provider: "AMAZON_SP_API",
      },
      data: {
        status: "REVOKED",
        encryptedRefreshToken: null,
        encryptionNonce: null,
        encryptionTag: null,
        encryptionKeyVersion: null,
        revokedAt: new Date(),
        lastErrorCode: "LOCAL_CONNECTION_REVOKED",
      },
    });
    if (!updated.count) throw new AmazonConnectionError("CONNECTION_NOT_FOUND");
    await transaction.providerEntitlement.updateMany({
      where: {
        organizationId: input.organizationId,
        providerConnectionId: input.connectionId,
      },
      data: {
        state: "UNAUTHORIZED",
        reasonCode: "LOCAL_CONNECTION_REVOKED",
        checkedAt: new Date(),
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "ProviderConnection",
        entityId: input.connectionId,
        eventType: "amazon.local_connection_revoked",
        idempotencyKey: `amazon-disconnect:${input.connectionId}:${randomUUID()}`,
        payload: { amazonRevocationRequiredSeparately: true },
      },
    });
    await transaction.securityAuditEvent.upsert({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: `security-amazon-disconnect:${input.connectionId}`,
        },
      },
      create: {
        organizationId: input.organizationId,
        eventType: "PROVIDER_DISCONNECTED",
        idempotencyKey: `security-amazon-disconnect:${input.connectionId}`,
        context: { localRevocationOnly: true },
      },
      update: {},
    });
    return true;
  });
}

export async function getAmazonIntegrationStatus(organizationId: string) {
  const connection = await db.providerConnection.findFirst({
    where: { organizationId, provider: "AMAZON_SP_API" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      mode: true,
      status: true,
      sellerId: true,
      marketplaceId: true,
      region: true,
      authorizedAt: true,
      lastValidatedAt: true,
      lastSuccessAt: true,
      lastErrorCode: true,
      revokedAt: true,
      updatedAt: true,
      marketplaces: {
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: {
          marketplaceId: true,
          name: true,
          countryCode: true,
          domainName: true,
          defaultCurrencyCode: true,
          defaultLanguageCode: true,
          isParticipating: true,
          hasSuspendedListings: true,
          isDefault: true,
          observedAt: true,
        },
      },
      entitlements: {
        orderBy: [{ marketplaceId: "asc" }, { capability: "asc" }],
        select: {
          providerKey: true,
          marketplaceId: true,
          capability: true,
          mode: true,
          state: true,
          reasonCode: true,
          completeness: true,
          checkedAt: true,
          expiresAt: true,
          retryAt: true,
          lastSuccessAt: true,
        },
      },
      jobs: {
        orderBy: { requestedAt: "desc" },
        take: 1,
        select: {
          id: true,
          kind: true,
          status: true,
          resultCode: true,
          requestedAt: true,
          completedAt: true,
        },
      },
    },
  });
  return connection;
}

export async function getLatestAmazonConnectionJob(organizationId: string) {
  return db.providerConnectionJob.findFirst({
    where: { organizationId },
    orderBy: { requestedAt: "desc" },
    select: {
      kind: true,
      status: true,
      resultCode: true,
      requestedAt: true,
      completedAt: true,
    },
  });
}

/** Resolve only a proven tenant connection. Mock is handled explicitly by the
 * local demo boundary and is never returned as an Amazon live connection. */
export async function resolveLiveAmazonConnection(input: {
  organizationId: string;
  marketplaceId?: string;
}) {
  const marketplaceFilter = input.marketplaceId
    ? { marketplaceId: input.marketplaceId, isParticipating: true }
    : { isParticipating: true, isDefault: true };
  return db.providerConnection.findFirst({
    where: {
      organizationId: input.organizationId,
      provider: "AMAZON_SP_API",
      status: "ACTIVE",
      encryptedRefreshToken: { not: null },
      marketplaces: {
        some: marketplaceFilter,
      },
    },
    orderBy: { lastSuccessAt: "desc" },
  });
}
