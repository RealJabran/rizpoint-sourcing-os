import { createHash, randomUUID } from "node:crypto";
import {
  LwaAccessTokenProvider,
  SP_API_ENDPOINTS,
  SpApiTransport,
  decryptAuthorizationCode,
  exchangeAuthorizationCode,
  getMarketplaceParticipations,
  probeAmazonCapabilities,
  readSpApiConfig,
  vaultFromEnvironment,
} from "@rizpoint/amazon-sp-api";
import {
  db,
  findAmazonCapabilityProbeAsins,
  getAmazonIntegrationStatus,
  persistAmazonMarketplaceParticipations,
  recordProviderRequestTelemetry,
  upsertProviderEntitlement,
} from "@rizpoint/database";
import type {
  ProviderCapability,
  ProviderOperationalState,
  ProviderUnavailableReason,
} from "@rizpoint/provider-contracts";
import { ProviderError } from "@rizpoint/provider-contracts";
import { createEnrichmentProvider } from "./enrichment-provider.js";

function endpointConfig(region: string) {
  if (region !== "NA" && region !== "EU" && region !== "FE")
    throw new Error("SP_API_REGION_INVALID");
  return readSpApiConfig({
    ...process.env,
    SP_API_ENDPOINT: SP_API_ENDPOINTS[region],
  });
}

function failureCode(error: unknown): string {
  return error instanceof ProviderError ? error.code : "CONNECTION_FAILED";
}

function failureStatus(code: string): "AUTH_REQUIRED" | "ERROR" {
  return code === "UNAUTHORIZED" || code === "FORBIDDEN"
    ? "AUTH_REQUIRED"
    : "ERROR";
}

const PROBED_CAPABILITIES = [
  "CATALOG",
  "COMPETITIVE_OFFERS",
  "FEES",
  "RESTRICTIONS",
] as const satisfies readonly ProviderCapability[];

function currencyForMarketplace(
  marketplaceId: string,
  discovered?: string | null,
) {
  if (discovered && /^[A-Z]{3}$/.test(discovered)) return discovered;
  const known: Record<string, string> = {
    ATVPDKIKX0DER: "USD",
    A2EUQ1WTGCTBG2: "CAD",
    A1F83G8C2ARO7P: "GBP",
    A1PA6795UKMFR9: "EUR",
  };
  return known[marketplaceId] ?? "USD";
}

async function persistUnavailableCapabilities(input: {
  organizationId: string;
  connectionId: string;
  marketplaceId: string;
  state: ProviderOperationalState;
  reason: ProviderUnavailableReason;
}) {
  const checkedAt = new Date();
  for (const capability of PROBED_CAPABILITIES)
    await upsertProviderEntitlement({
      organizationId: input.organizationId,
      providerConnectionId: input.connectionId,
      providerKey: "amazon-sp-api",
      marketplaceId: input.marketplaceId,
      capability,
      mode: "LIVE",
      state: input.state,
      reason: input.reason,
      completeness: "UNKNOWN",
      checkedAt,
    });
}

async function refreshAmazonCapabilities(input: {
  jobId: string;
  attempt: number;
  organizationId: string;
  connectionId: string;
}) {
  const [status, persistedConnection] = await Promise.all([
    getAmazonIntegrationStatus(input.organizationId),
    db.providerConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
        provider: "AMAZON_SP_API",
        status: "ACTIVE",
      },
    }),
  ]);
  if (!status || !persistedConnection) throw new ProviderError("UNAUTHORIZED");
  const marketplaces = status.marketplaces.filter(
    (item) => item.isParticipating,
  );
  if (!marketplaces.length) throw new ProviderError("INVALID_RESPONSE");
  const reportStates: ProviderOperationalState[] = [];
  for (const marketplace of marketplaces) {
    let bundle: ReturnType<typeof createEnrichmentProvider>;
    try {
      bundle = createEnrichmentProvider({
        ...persistedConnection,
        marketplaceId: marketplace.marketplaceId,
      });
    } catch {
      const missingConfiguration =
        !process.env.SP_API_LWA_CLIENT_ID ||
        !process.env.SP_API_LWA_CLIENT_SECRET ||
        !process.env.PROVIDER_CREDENTIAL_KEY_V1;
      await persistUnavailableCapabilities({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        marketplaceId: marketplace.marketplaceId,
        state: missingConfiguration ? "NOT_CONFIGURED" : "UNAUTHORIZED",
        reason: missingConfiguration
          ? "CREDENTIALS_MISSING"
          : "CONNECTION_NOT_AUTHORIZED",
      });
      reportStates.push(
        missingConfiguration ? "NOT_CONFIGURED" : "UNAUTHORIZED",
      );
      continue;
    }
    const asins = await findAmazonCapabilityProbeAsins({
      organizationId: input.organizationId,
      marketplaceId: marketplace.marketplaceId,
      limit: 5,
    });
    const report = await probeAmazonCapabilities({
      provider: bundle.provider,
      marketplace: bundle.marketplace,
      asins,
      ...(process.env.SP_API_CAPABILITY_PROBE_KEYWORD
        ? { keyword: process.env.SP_API_CAPABILITY_PROBE_KEYWORD }
        : {}),
      feePrice: process.env.SP_API_CAPABILITY_PROBE_PRICE ?? "20.00",
      currency: currencyForMarketplace(
        marketplace.marketplaceId,
        marketplace.defaultCurrencyCode,
      ),
    });
    for (const capability of report.capabilities) {
      await upsertProviderEntitlement({
        organizationId: input.organizationId,
        providerConnectionId: input.connectionId,
        providerKey: "amazon-sp-api",
        marketplaceId: marketplace.marketplaceId,
        capability: capability.capability,
        mode: "LIVE",
        state: capability.state,
        ...(capability.reason ? { reason: capability.reason } : {}),
        completeness: capability.completeness,
        checkedAt: new Date(capability.checkedAt),
        ...(capability.retryAt
          ? { retryAt: new Date(capability.retryAt) }
          : {}),
      });
      reportStates.push(capability.state);
    }
    for (const [index, operation] of report.operations.entries()) {
      await recordProviderRequestTelemetry({
        organizationId: input.organizationId,
        providerKey: "amazon-sp-api",
        marketplaceId: marketplace.marketplaceId,
        capability: operation.capability,
        operation: operation.operation,
        requestHash: createHash("sha256")
          .update(
            `${input.jobId}:${marketplace.marketplaceId}:${operation.operation}:${index}`,
          )
          .digest("hex"),
        mode: "LIVE",
        state: operation.state,
        attempt: input.attempt,
        startedAt: new Date(operation.checkedAt),
        completedAt: new Date(),
        ...(operation.retryAt ? { retryAt: new Date(operation.retryAt) } : {}),
        ...(operation.httpStatus === undefined
          ? {}
          : { httpStatus: operation.httpStatus }),
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.providerRequestId
          ? { providerRequestId: operation.providerRequestId }
          : {}),
      });
    }
  }
  return reportStates.some((state) =>
    [
      "UNAUTHORIZED",
      "THROTTLED",
      "UNAVAILABLE",
      "PARTIAL",
      "NOT_CONFIGURED",
    ].includes(state),
  )
    ? "CAPABILITIES_PARTIAL"
    : "CAPABILITIES_CHECKED";
}

async function validatePersistedConnection(input: {
  organizationId: string;
  providerConnectionId: string;
}) {
  const connection = await db.providerConnection.findFirst({
    where: {
      id: input.providerConnectionId,
      organizationId: input.organizationId,
      provider: "AMAZON_SP_API",
      status: { not: "REVOKED" },
    },
  });
  if (
    !connection?.encryptedRefreshToken ||
    !connection.encryptionNonce ||
    !connection.encryptionTag ||
    !connection.encryptionKeyVersion
  )
    throw new ProviderError("UNAUTHORIZED");
  const vault = vaultFromEnvironment();
  if (!vault) throw new Error("CREDENTIAL_VAULT_NOT_CONFIGURED");
  const refreshToken = vault.decrypt(
    {
      ciphertext: connection.encryptedRefreshToken,
      nonce: connection.encryptionNonce,
      tag: connection.encryptionTag,
      keyVersion: connection.encryptionKeyVersion,
    },
    `${connection.organizationId}:${connection.id}`,
  );
  const config = endpointConfig(connection.region);
  const tokens = new LwaAccessTokenProvider(config, refreshToken);
  const result = await getMarketplaceParticipations(
    new SpApiTransport(
      config,
      Object.assign(() => tokens.getAccessToken(), {
        invalidate: () => tokens.invalidate(),
      }),
    ),
  );
  const observedAt = new Date(result.observedAt);
  await persistAmazonMarketplaceParticipations({
    organizationId: connection.organizationId,
    connectionId: connection.id,
    participations: result.participations,
    observedAt,
  });
  await db.providerConnection.update({
    where: { id: connection.id },
    data: {
      status: "ACTIVE",
      lastValidatedAt: observedAt,
      lastSuccessAt: observedAt,
      lastErrorCode: null,
      revokedAt: null,
    },
  });
  return connection.id;
}

async function completeOAuth(input: {
  jobId: string;
  organizationId: string;
  authorizationStateId: string;
}) {
  const state = await db.providerAuthorizationState.findFirst({
    where: {
      id: input.authorizationStateId,
      organizationId: input.organizationId,
      provider: "AMAZON_SP_API",
    },
  });
  if (
    !state?.encryptedOauthCode ||
    !state.oauthCodeKeyVersion ||
    !state.sellerId ||
    !state.callbackReceivedAt
  )
    throw new Error("OAUTH_CALLBACK_DATA_MISSING");
  if (Date.now() - state.callbackReceivedAt.getTime() >= 5 * 60_000)
    throw new Error("OAUTH_CODE_EXPIRED");
  const expectedKeyVersion = Number(
    process.env.SP_API_OAUTH_CALLBACK_KEY_VERSION ?? "1",
  );
  if (state.oauthCodeKeyVersion !== expectedKeyVersion)
    throw new Error("OAUTH_CODE_KEY_UNAVAILABLE");
  const privateKey = process.env.SP_API_OAUTH_CALLBACK_PRIVATE_KEY;
  const redirectUri = process.env.SP_API_OAUTH_REDIRECT_URI;
  if (!privateKey || !redirectUri)
    throw new Error("OAUTH_WORKER_NOT_CONFIGURED");
  const code = decryptAuthorizationCode(state.encryptedOauthCode, privateKey);
  const config = endpointConfig(state.region);
  const exchanged = await exchangeAuthorizationCode(config, code, redirectUri);
  const vault = vaultFromEnvironment();
  if (!vault) throw new Error("CREDENTIAL_VAULT_NOT_CONFIGURED");
  const existingById = state.providerConnectionId
    ? await db.providerConnection.findFirst({
        where: {
          id: state.providerConnectionId,
          organizationId: state.organizationId,
          provider: "AMAZON_SP_API",
        },
      })
    : null;
  const existing =
    existingById ??
    (await db.providerConnection.findUnique({
      where: {
        organizationId_provider_marketplaceId: {
          organizationId: state.organizationId,
          provider: "AMAZON_SP_API",
          marketplaceId: state.marketplaceId,
        },
      },
    }));
  const connectionId =
    existing?.id ?? state.providerConnectionId ?? randomUUID();
  const encrypted = vault.encrypt(
    exchanged.refreshToken,
    `${state.organizationId}:${connectionId}`,
  );
  const authorizedAt = new Date();
  const connection = existing
    ? await db.providerConnection.update({
        where: { id: existing.id },
        data: {
          mode: "OAUTH",
          status: "PENDING",
          sellerId: state.sellerId,
          region: state.region,
          encryptedRefreshToken: encrypted.ciphertext,
          encryptionNonce: encrypted.nonce,
          encryptionTag: encrypted.tag,
          encryptionKeyVersion: encrypted.keyVersion,
          authorizedAt,
          lastErrorCode: null,
          revokedAt: null,
        },
      })
    : await db.providerConnection.create({
        data: {
          id: connectionId,
          organizationId: state.organizationId,
          provider: "AMAZON_SP_API",
          mode: "OAUTH",
          status: "PENDING",
          sellerId: state.sellerId,
          marketplaceId: state.marketplaceId,
          region: state.region,
          encryptedRefreshToken: encrypted.ciphertext,
          encryptionNonce: encrypted.nonce,
          encryptionTag: encrypted.tag,
          encryptionKeyVersion: encrypted.keyVersion,
          authorizedAt,
        },
      });
  // The LWA code is single-use. Persist the encrypted refresh token and move
  // the retry checkpoint to connection validation before calling Sellers.
  await db.$transaction([
    db.providerConnectionJob.update({
      where: { id: input.jobId },
      data: { providerConnectionId: connection.id },
    }),
    db.providerAuthorizationState.update({
      where: { id: state.id },
      data: {
        providerConnectionId: connection.id,
        encryptedOauthCode: null,
        oauthCodeKeyVersion: null,
      },
    }),
  ]);
  const result = await getMarketplaceParticipations(
    new SpApiTransport(config, async () => exchanged.accessToken),
  );
  const observedAt = new Date(result.observedAt);
  await persistAmazonMarketplaceParticipations({
    organizationId: state.organizationId,
    connectionId: connection.id,
    participations: result.participations,
    observedAt,
    preferredMarketplaceId: state.marketplaceId,
  });
  await db.providerConnection.update({
    where: { id: connection.id },
    data: {
      status: "ACTIVE",
      lastValidatedAt: observedAt,
      lastSuccessAt: observedAt,
      lastErrorCode: null,
    },
  });
  await db.providerAuthorizationState.update({
    where: { id: state.id },
    data: {
      providerConnectionId: connection.id,
      encryptedOauthCode: null,
      oauthCodeKeyVersion: null,
      completedAt: observedAt,
      failureCode: null,
    },
  });
  return connection.id;
}

export async function processProviderConnectionJob(jobId: string) {
  const claimed = await db.providerConnectionJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["PENDING", "FAILED_RETRYABLE"] },
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      attemptCount: { increment: 1 },
      resultCode: null,
    },
  });
  if (claimed.count !== 1) return;
  const job = await db.providerConnectionJob.findUnique({
    where: { id: jobId },
  });
  if (!job) throw new Error("PROVIDER_CONNECTION_JOB_NOT_FOUND");
  try {
    const connectionId =
      job.kind === "OAUTH_COMPLETE" && !job.providerConnectionId
        ? await completeOAuth({
            jobId: job.id,
            organizationId: job.organizationId,
            authorizationStateId: job.authorizationStateId!,
          })
        : await validatePersistedConnection({
            organizationId: job.organizationId,
            providerConnectionId: job.providerConnectionId!,
          });
    const capabilityResult =
      job.kind === "VALIDATE"
        ? "CONNECTION_VALIDATED"
        : await refreshAmazonCapabilities({
            jobId: job.id,
            attempt: Math.max(job.attemptCount, 1),
            organizationId: job.organizationId,
            connectionId,
          });
    if (job.authorizationStateId)
      await db.providerAuthorizationState.updateMany({
        where: {
          id: job.authorizationStateId,
          organizationId: job.organizationId,
        },
        data: {
          completedAt: new Date(),
          failureCode: null,
          encryptedOauthCode: null,
          oauthCodeKeyVersion: null,
        },
      });
    await db.$transaction([
      db.providerConnectionJob.update({
        where: { id: job.id },
        data: {
          providerConnectionId: connectionId,
          status: "COMPLETED",
          resultCode: capabilityResult,
          completedAt: new Date(),
        },
      }),
      db.workflowAuditEvent.upsert({
        where: {
          organizationId_idempotencyKey: {
            organizationId: job.organizationId,
            idempotencyKey: `provider-connection-completed:${job.id}`,
          },
        },
        create: {
          organizationId: job.organizationId,
          entityType: "ProviderConnection",
          entityId: connectionId,
          eventType:
            job.kind === "OAUTH_COMPLETE"
              ? "amazon.authorization_completed"
              : job.kind === "REFRESH_CAPABILITIES"
                ? "amazon.capabilities_refreshed"
                : "amazon.connection_validated",
          idempotencyKey: `provider-connection-completed:${job.id}`,
          payload: {
            mode: job.kind === "OAUTH_COMPLETE" ? "OAUTH" : "LIVE",
            result: capabilityResult,
          },
        },
        update: {},
      }),
      ...(job.kind === "OAUTH_COMPLETE"
        ? [
            db.securityAuditEvent.upsert({
              where: {
                organizationId_idempotencyKey: {
                  organizationId: job.organizationId,
                  idempotencyKey: `security-provider-connected:${job.id}`,
                },
              },
              create: {
                organizationId: job.organizationId,
                eventType: "PROVIDER_CONNECTED",
                idempotencyKey: `security-provider-connected:${job.id}`,
                context: { provider: "AMAZON_SP_API", mode: "OAUTH" },
              },
              update: {},
            }),
          ]
        : []),
    ]);
  } catch (error) {
    const code = failureCode(error);
    const persistedJob = await db.providerConnectionJob.findUnique({
      where: { id: job.id },
      select: { providerConnectionId: true },
    });
    const providerConnectionId =
      job.providerConnectionId ?? persistedJob?.providerConnectionId;
    if (providerConnectionId)
      await db.providerConnection.updateMany({
        where: {
          id: providerConnectionId,
          organizationId: job.organizationId,
          status: { not: "REVOKED" },
        },
        data: {
          status: failureStatus(code),
          lastValidatedAt: new Date(),
          lastErrorCode: code,
        },
      });
    if (job.authorizationStateId)
      await db.providerAuthorizationState.updateMany({
        where: {
          id: job.authorizationStateId,
          organizationId: job.organizationId,
        },
        data: {
          failureCode: code,
        },
      });
    throw error;
  }
}

export async function failProviderConnectionJob(
  jobId: string,
  final: boolean,
  error: unknown,
) {
  const job = await db.providerConnectionJob.findUnique({
    where: { id: jobId },
    select: { authorizationStateId: true },
  });
  await db.providerConnectionJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: final ? "FAILED_FINAL" : "FAILED_RETRYABLE",
      resultCode: failureCode(error),
      ...(final ? { completedAt: new Date() } : {}),
    },
  });
  if (final && job?.authorizationStateId)
    await db.providerAuthorizationState.updateMany({
      where: { id: job.authorizationStateId },
      data: {
        encryptedOauthCode: null,
        oauthCodeKeyVersion: null,
        failureCode: failureCode(error),
      },
    });
}
