"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import {
  Alert,
  Badge,
  Button,
  Card,
  SelectControl,
  Skeleton,
  useToast,
} from "@/src/components/ui";

type ConnectionState =
  | "NOT_CONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "AUTH_REQUIRED"
  | "UNAUTHORIZED"
  | "THROTTLED"
  | "ERROR"
  | "PARTIAL";

type IntegrationStatus = {
  providerName: string;
  connectionState: ConnectionState;
  dataOrigin: "LIVE_AMAZON" | "NONE";
  localDemo: boolean;
  oauthAvailable: boolean;
  selfAuthorizedReady: boolean;
  connection: null | {
    mode: "SELF_AUTHORIZED" | "OAUTH";
    sellerIdentity: string | null;
    region: string;
    connectedAt: string | null;
    lastValidatedAt: string | null;
    lastSuccessfulValidation: string | null;
    lastErrorCode: string | null;
    revokedAt: string | null;
    marketplaces: Array<{
      marketplaceId: string;
      name: string;
      countryCode: string | null;
      defaultCurrencyCode: string | null;
      defaultLanguageCode: string | null;
      isParticipating: boolean;
      hasSuspendedListings: boolean;
      isDefault: boolean;
      observedAt: string;
    }>;
    capabilities: Array<{
      marketplaceId: string;
      capability: string;
      source: "Amazon Selling Partner API";
      dataOrigin: "LIVE_AMAZON";
      mode: "LIVE";
      state: string;
      reasonCode: string | null;
      completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
      freshness: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
      checkedAt: string;
      expiresAt: string | null;
      retryAt: string | null;
      lastSuccessAt: string | null;
    }>;
  };
  latestAction: null | {
    kind: string;
    status: string;
    resultCode: string | null;
    requestedAt: string;
    completedAt: string | null;
  };
};

const connectMarkets = [
  { id: "ATVPDKIKX0DER", label: "United States · amazon.com" },
  { id: "A2EUQ1WTGCTBG2", label: "Canada · amazon.ca" },
  { id: "A1F83G8C2ARO7P", label: "United Kingdom · amazon.co.uk" },
  { id: "A1PA6795UKMFR9", label: "Germany · amazon.de" },
];

const statePresentation: Record<
  ConnectionState,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  NOT_CONNECTED: { label: "Not connected", tone: "neutral" },
  CONNECTING: { label: "Connecting", tone: "info" },
  CONNECTED: { label: "Connected", tone: "success" },
  AUTH_REQUIRED: { label: "Authorization required", tone: "warning" },
  UNAUTHORIZED: { label: "Disconnected", tone: "danger" },
  THROTTLED: { label: "Amazon is throttling checks", tone: "warning" },
  ERROR: { label: "Connection error", tone: "danger" },
  PARTIAL: { label: "Partially available", tone: "warning" },
};

const humanErrors: Record<string, string> = {
  UNAUTHORIZED:
    "Amazon rejected the authorization. Reauthorize the application.",
  FORBIDDEN: "This seller account has not granted a required SP-API role.",
  THROTTLED:
    "Amazon delayed this validation. Existing data remains unchanged; retry shortly.",
  INVALID_RESPONSE:
    "Amazon returned an incomplete response. No connection secrets were exposed.",
  LOCAL_CONNECTION_REVOKED:
    "The local RizPoint credential was removed. Revoke the app in Amazon separately if required.",
  OAUTH_CODE_EXPIRED:
    "The Amazon authorization window expired. Start the connection again.",
  CONNECTION_FAILED:
    "The connection could not be validated. Review worker configuration and retry.",
};

const capabilityLabels: Record<string, string> = {
  CATALOG: "Catalog lookup & search",
  COMPETITIVE_OFFERS: "Competitive offers",
  FEES: "Fee estimates",
  RESTRICTIONS: "Selling eligibility",
};

const unavailableFamilies = [
  {
    label: "Historical market data",
    detail:
      "Requires a licensed history provider; SP-API is not a market-history database.",
  },
  {
    label: "Keyword volume",
    detail:
      "Requires a licensed keyword provider; Catalog keyword search does not expose volume.",
  },
  {
    label: "Reverse-ASIN ranks",
    detail:
      "Requires a licensed rank provider; RizPoint never infers ranks from Amazon HTML.",
  },
] as const;

function capabilityPresentation(state: string) {
  if (state === "HEALTHY")
    return { label: "Connected", tone: "success" as const };
  if (state === "AUTHORIZED")
    return { label: "Authorized · awaiting proof", tone: "info" as const };
  if (state === "THROTTLED")
    return { label: "Retry scheduled", tone: "warning" as const };
  if (state === "PARTIAL")
    return { label: "Partial response", tone: "warning" as const };
  if (state === "UNAUTHORIZED")
    return { label: "Not granted", tone: "danger" as const };
  if (state === "NOT_CONFIGURED")
    return { label: "Server setup required", tone: "warning" as const };
  return { label: "Unavailable", tone: "neutral" as const };
}

function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not yet";
}

export function AmazonIntegrationWorkspace() {
  const { notify } = useToast();
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [marketplaceId, setMarketplaceId] = useState("ATVPDKIKX0DER");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/amazon", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
      const next = (await response.json()) as IntegrationStatus;
      setStatus(next);
      setError(null);
      const selected = next.connection?.marketplaces.find(
        (item) => item.isDefault,
      );
      if (selected) setMarketplaceId(selected.marketplaceId);
    } catch {
      setError("Amazon connection status is temporarily unavailable.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (status?.connectionState !== "CONNECTING") return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [load, status?.connectionState]);

  async function connect() {
    if (!status?.oauthAvailable) {
      document.getElementById("self-authorized-setup")?.scrollIntoView({
        behavior: "smooth",
      });
      notify(
        "Follow the secure owner setup below; this page will detect it.",
        "info",
      );
      return;
    }
    setBusy("connect");
    try {
      const response = await fetch("/api/providers/amazon/oauth/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId }),
      });
      const result = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!response.ok || !result.authorizationUrl)
        throw new Error(result.error ?? "OAUTH_START_FAILED");
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      notify(
        humanErrors[caught instanceof Error ? caught.message : ""] ??
          "Amazon authorization could not be started.",
        "danger",
      );
      setBusy(null);
    }
  }

  async function action(
    value:
      "TEST_CONNECTION" | "REFRESH_CAPABILITIES" | "SET_DEFAULT_MARKETPLACE",
    selectedMarketplaceId?: string,
  ) {
    setBusy(value);
    try {
      const response = await fetch("/api/providers/amazon/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: value,
          ...(selectedMarketplaceId
            ? { marketplaceId: selectedMarketplaceId }
            : {}),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "ACTION_FAILED");
      notify(
        value === "SET_DEFAULT_MARKETPLACE"
          ? "Active Amazon marketplace updated."
          : "Amazon validation queued securely.",
      );
      await load();
    } catch (caught) {
      notify(
        humanErrors[caught instanceof Error ? caught.message : ""] ??
          "The Amazon action could not be completed.",
        "danger",
      );
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Remove the encrypted Amazon credential from RizPoint? This does not revoke the app inside Seller Central.",
      )
    )
      return;
    setBusy("disconnect");
    try {
      const response = await fetch("/api/providers/amazon", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("DISCONNECT_FAILED");
      notify("The local Amazon connection was removed.", "warning");
      await load();
    } catch {
      notify("The local connection could not be removed.", "danger");
    } finally {
      setBusy(null);
    }
  }

  const state = status
    ? statePresentation[status.connectionState]
    : statePresentation.NOT_CONNECTED;
  const connected =
    status?.connectionState === "CONNECTED" ||
    status?.connectionState === "PARTIAL" ||
    status?.connectionState === "THROTTLED";

  return (
    <main className="content-page amazon-integration">
      <PageHeader
        title="Amazon integration"
        description="Connect Seller Central to bring authorized Amazon catalog, pricing, fee, and restriction evidence into RizPoint."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Settings", href: "/settings/integrations" },
          { label: "Amazon" },
        ]}
      />

      {error ? (
        <Alert tone="danger" title="Status unavailable">
          {error}
        </Alert>
      ) : null}
      {status?.localDemo ? (
        <Alert tone="info" title="Local demo mode">
          Fixture data may be used by local demo workflows, but it is never
          labeled as connected Amazon evidence. A live connection remains
          organization-specific.
        </Alert>
      ) : null}

      <Card className="amazon-provider-card">
        <div className="amazon-provider-card__identity">
          <span className="amazon-provider-mark" aria-hidden="true">
            a
          </span>
          <div>
            <span className="eyebrow">Official provider</span>
            <h2>Amazon Selling Partner API</h2>
            <p>
              Read-only research enrichment through your authorized seller
              account.
            </p>
          </div>
        </div>
        <div className="amazon-provider-card__status">
          {status ? (
            <Badge tone={state.tone}>{state.label}</Badge>
          ) : (
            <Skeleton />
          )}
          <span>
            {status?.dataOrigin === "LIVE_AMAZON"
              ? "LIVE AMAZON · tenant connection"
              : "No live Amazon data"}
          </span>
        </div>
      </Card>

      {!status ? (
        <Card className="amazon-loading" aria-label="Loading Amazon connection">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </Card>
      ) : (
        <>
          {status.connection?.lastErrorCode ? (
            <Alert
              tone={
                status.connectionState === "THROTTLED" ? "warning" : "danger"
              }
              title="Amazon needs attention"
            >
              {humanErrors[status.connection.lastErrorCode] ??
                "Amazon could not complete the most recent validation. Existing observations were preserved."}
            </Alert>
          ) : null}

          <div className="amazon-summary-grid">
            <Card>
              <span>Seller</span>
              <strong>
                {status.connection?.sellerIdentity ?? "Not connected"}
              </strong>
            </Card>
            <Card>
              <span>Region</span>
              <strong>{status.connection?.region ?? "—"}</strong>
            </Card>
            <Card>
              <span>Connected</span>
              <strong>
                {dateTime(status.connection?.connectedAt ?? null)}
              </strong>
            </Card>
            <Card>
              <span>Last successful check</span>
              <strong>
                {dateTime(status.connection?.lastSuccessfulValidation ?? null)}
              </strong>
            </Card>
          </div>

          <Card className="amazon-actions-card">
            <div>
              <h2>{connected ? "Connection controls" : "Connect Amazon"}</h2>
              <p>
                {connected
                  ? "Validation runs in the background and never removes prior observations when Amazon is unavailable."
                  : "Choose the marketplace where you begin authorization. RizPoint discovers every accessible marketplace after connection."}
              </p>
            </div>
            {!connected ? (
              <div className="amazon-connect-row">
                <SelectControl
                  aria-label="Amazon authorization marketplace"
                  value={marketplaceId}
                  onChange={(event) => setMarketplaceId(event.target.value)}
                >
                  {connectMarkets.map((market) => (
                    <option key={market.id} value={market.id}>
                      {market.label}
                    </option>
                  ))}
                </SelectControl>
                <Button
                  onClick={() => void connect()}
                  loading={busy === "connect"}
                >
                  {status.oauthAvailable
                    ? "Connect Amazon"
                    : "View secure setup"}
                </Button>
              </div>
            ) : (
              <div className="amazon-action-row">
                {status.oauthAvailable ? (
                  <Button
                    variant="secondary"
                    onClick={() => void connect()}
                    loading={busy === "connect"}
                  >
                    Reconnect Amazon
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => void action("TEST_CONNECTION")}
                  loading={busy === "TEST_CONNECTION"}
                >
                  Test connection
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void action("REFRESH_CAPABILITIES")}
                  loading={busy === "REFRESH_CAPABILITIES"}
                >
                  Refresh capabilities
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void disconnect()}
                  loading={busy === "disconnect"}
                >
                  Disconnect locally
                </Button>
              </div>
            )}
            {status.latestAction ? (
              <div className="amazon-test-result" role="status">
                <strong>Latest check</strong>
                <span>
                  {status.latestAction.status
                    .replaceAll("_", " ")
                    .toLowerCase()}
                </span>
                <span>
                  {dateTime(
                    status.latestAction.completedAt ??
                      status.latestAction.requestedAt,
                  )}
                </span>
              </div>
            ) : null}
          </Card>

          <Card className="amazon-marketplaces-card">
            <div className="section-heading">
              <div>
                <h2>Connected marketplaces</h2>
                <p>Discovered from Sellers API marketplace participations.</p>
              </div>
              <Badge tone="info">Tenant scoped</Badge>
            </div>
            {status.connection?.marketplaces.length ? (
              <div className="amazon-marketplace-list">
                {status.connection.marketplaces.map((marketplace) => (
                  <div key={marketplace.marketplaceId}>
                    <div>
                      <strong>{marketplace.name}</strong>
                      <span>
                        {[
                          marketplace.countryCode,
                          marketplace.defaultCurrencyCode,
                          marketplace.defaultLanguageCode,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="badge-stack">
                      {!marketplace.isParticipating ? (
                        <Badge tone="warning">Unavailable</Badge>
                      ) : null}
                      {marketplace.hasSuspendedListings ? (
                        <Badge tone="danger">Listings suspended</Badge>
                      ) : null}
                      {marketplace.isDefault ? (
                        <Badge tone="success">Active</Badge>
                      ) : marketplace.isParticipating ? (
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() =>
                            void action(
                              "SET_DEFAULT_MARKETPLACE",
                              marketplace.marketplaceId,
                            )
                          }
                          loading={busy === "SET_DEFAULT_MARKETPLACE"}
                        >
                          Use marketplace
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="amazon-empty">
                <strong>No marketplaces discovered yet.</strong>
                <span>
                  Connect and test Amazon to retrieve authorized marketplace
                  participations.
                </span>
              </div>
            )}
          </Card>

          <Card className="amazon-capabilities-card">
            <div className="section-heading">
              <div>
                <h2>Capability status</h2>
                <p>Availability can differ by marketplace and granted role.</p>
              </div>
            </div>
            {status.connection?.capabilities.length ? (
              <div className="amazon-capability-table-wrap">
                <table className="amazon-capability-table">
                  <thead>
                    <tr>
                      <th>Capability</th>
                      <th>Marketplace</th>
                      <th>Status</th>
                      <th>Evidence</th>
                      <th>Last checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.connection.capabilities.map((capability) => {
                      const presentation = capabilityPresentation(
                        capability.state,
                      );
                      return (
                        <tr
                          key={`${capability.marketplaceId}:${capability.capability}`}
                        >
                          <td>
                            {capabilityLabels[capability.capability] ??
                              capability.capability
                                .replaceAll("_", " ")
                                .toLowerCase()}
                          </td>
                          <td>
                            {status.connection?.marketplaces.find(
                              (item) =>
                                item.marketplaceId === capability.marketplaceId,
                            )?.name ?? "Known marketplace"}
                          </td>
                          <td>
                            <Badge tone={presentation.tone}>
                              {presentation.label}
                            </Badge>
                            {capability.retryAt ? (
                              <span>
                                Retry after {dateTime(capability.retryAt)}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <strong>LIVE AMAZON</strong>
                            <span>
                              {capability.completeness.toLowerCase()} ·{" "}
                              {capability.freshness.toLowerCase()}
                            </span>
                          </td>
                          <td>{dateTime(capability.checkedAt)}</td>
                        </tr>
                      );
                    })}
                    {unavailableFamilies.map((family) => (
                      <tr key={family.label}>
                        <td>
                          <strong>{family.label}</strong>
                          <span>{family.detail}</span>
                        </td>
                        <td>All marketplaces</td>
                        <td>
                          <Badge tone="neutral">Provider required</Badge>
                        </td>
                        <td>
                          <strong>NOT AVAILABLE</strong>
                          <span>No value shown</span>
                        </td>
                        <td>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="amazon-empty">
                <strong>Capabilities not validated.</strong>
                <span>
                  No unsupported metric will be presented as live Amazon data.
                </span>
              </div>
            )}
          </Card>

          <Card className="amazon-onboarding" id="self-authorized-setup">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Private owner setup</span>
                <h2>Secure self-authorization</h2>
                <p>
                  Keep the refresh token out of the browser. Complete the
                  one-time import on the RizPoint server.
                </p>
              </div>
              <Badge tone={status.selfAuthorizedReady ? "success" : "neutral"}>
                {status.selfAuthorizedReady ? "Completed" : "Available now"}
              </Badge>
            </div>
            <ol>
              <li>
                <span>1</span>
                <div>
                  <strong>Locate the private SP-API application</strong>
                  <p>
                    Open Solution Provider Portal and confirm its approved roles
                    and LWA credentials.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Authorize the Seller Central account</strong>
                  <p>
                    As the account Primary User, choose Authorize app and
                    securely capture the new refresh token.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Prepare the server-only environment</strong>
                  <p>
                    Use the ignored owner-only file described in{" "}
                    <code>docs/AMAZON_CONNECTION.md</code>. Never place
                    credentials in web or <code>NEXT_PUBLIC_*</code> settings.
                  </p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>Run the secure connection command</strong>
                  <p>
                    <code>pnpm sp-api:connect</code> validates Amazon, encrypts
                    the refresh token, and discovers marketplaces.
                  </p>
                </div>
              </li>
              <li>
                <span>5</span>
                <div>
                  <strong>Return here and test</strong>
                  <p>
                    This screen detects the connection automatically. Use Test
                    connection for a fresh worker-side validation.
                  </p>
                </div>
              </li>
            </ol>
          </Card>
        </>
      )}
    </main>
  );
}
