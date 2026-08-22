import { randomUUID } from "node:crypto";
import {
  LwaAccessTokenProvider,
  SP_API_ENDPOINTS,
  SpApiTransport,
  decryptAuthorizationCode,
  exchangeAuthorizationCode,
  getMarketplaceParticipations,
  readSpApiConfig,
  vaultFromEnvironment,
} from "@rizpoint/amazon-sp-api";
import { db, persistAmazonMarketplaceParticipations } from "@rizpoint/database";
import { ProviderError } from "@rizpoint/provider-contracts";

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
          resultCode: "CONNECTED",
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
              : "amazon.connection_validated",
          idempotencyKey: `provider-connection-completed:${job.id}`,
          payload: { mode: job.kind === "OAUTH_COMPLETE" ? "OAUTH" : "LIVE" },
        },
        update: {},
      }),
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
