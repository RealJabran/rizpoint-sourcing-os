import { NextRequest, NextResponse } from "next/server";
import { amazonOAuthPublicConfigurationAvailable } from "@rizpoint/amazon-sp-api";
import {
  disconnectAmazonConnection,
  getAmazonIntegrationStatus,
  getLatestAmazonConnectionJob,
} from "@rizpoint/database";
import { isLocalDemoMode } from "@/src/phase-zero";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

export const runtime = "nodejs";

function publicState(
  connection: Awaited<ReturnType<typeof getAmazonIntegrationStatus>>,
  latestJob: Awaited<ReturnType<typeof getLatestAmazonConnectionJob>>,
) {
  if (
    latestJob &&
    ["PENDING", "RUNNING", "FAILED_RETRYABLE"].includes(latestJob.status)
  )
    return "CONNECTING";
  if (!connection && latestJob?.status === "FAILED_FINAL") {
    if (latestJob.resultCode === "THROTTLED") return "THROTTLED";
    if (
      latestJob.resultCode === "UNAUTHORIZED" ||
      latestJob.resultCode === "FORBIDDEN"
    )
      return "AUTH_REQUIRED";
    return "ERROR";
  }
  if (!connection) return "NOT_CONNECTED";
  if (connection.status === "REVOKED") return "UNAUTHORIZED";
  if (connection.lastErrorCode === "THROTTLED") return "THROTTLED";
  if (connection.status === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  if (connection.status === "ERROR") return "ERROR";
  if (connection.status === "PENDING") return "CONNECTING";
  const participating = connection.marketplaces.filter(
    (marketplace) => marketplace.isParticipating,
  );
  const states = connection.entitlements.map((item) => item.state);
  const usableStates = new Set(["AUTHORIZED", "CONFIGURED", "HEALTHY"]);
  if (!participating.length || states.some((state) => !usableStates.has(state)))
    return "PARTIAL";
  return "CONNECTED";
}

function safeSellerIdentity(value: string | null) {
  if (!value) return null;
  return `Seller account ••••${value.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  const [connection, latestJob] = await Promise.all([
    getAmazonIntegrationStatus(organization.id),
    getLatestAmazonConnectionJob(organization.id),
  ]);
  return NextResponse.json(
    {
      provider: "amazon-sp-api",
      providerName: "Amazon Selling Partner API",
      connectionState: publicState(connection, latestJob),
      dataOrigin: connection?.status === "ACTIVE" ? "LIVE_PROVIDER" : "NONE",
      localDemo: isLocalDemoMode(),
      oauthAvailable: amazonOAuthPublicConfigurationAvailable(),
      selfAuthorizedReady: connection?.mode === "SELF_AUTHORIZED",
      connection: connection
        ? {
            mode: connection.mode,
            sellerIdentity: safeSellerIdentity(connection.sellerId),
            region: connection.region,
            connectedAt: connection.authorizedAt?.toISOString() ?? null,
            lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
            lastSuccessfulValidation:
              connection.lastSuccessAt?.toISOString() ?? null,
            lastErrorCode: connection.lastErrorCode,
            revokedAt: connection.revokedAt?.toISOString() ?? null,
            marketplaces: connection.marketplaces.map((marketplace) => ({
              ...marketplace,
              observedAt: marketplace.observedAt.toISOString(),
            })),
            capabilities: connection.entitlements.map((capability) => ({
              ...capability,
              checkedAt: capability.checkedAt.toISOString(),
              lastSuccessAt: capability.lastSuccessAt?.toISOString() ?? null,
            })),
          }
        : null,
      latestAction: latestJob
        ? {
            ...latestJob,
            requestedAt: latestJob.requestedAt.toISOString(),
            completedAt: latestJob.completedAt?.toISOString() ?? null,
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  const connection = await getAmazonIntegrationStatus(organization.id);
  if (!connection)
    return NextResponse.json(
      { error: "CONNECTION_NOT_FOUND" },
      { status: 404 },
    );
  await disconnectAmazonConnection({
    organizationId: organization.id,
    connectionId: connection.id,
  });
  return NextResponse.json({ status: "UNAUTHORIZED" });
}
