"use client";

import {
  ArrowRight,
  DatabaseZap,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  X,
  Zap,
} from "lucide-react";
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
  const [setupOpen, setSetupOpen] = useState(false);

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
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get(
      "authorization",
    );
    if (!outcome) return;
    if (outcome === "processing")
      notify(
        "Amazon approved access. RizPoint is securely validating your seller account.",
        "success",
      );
    else
      notify(
        outcome === "invalid_state"
          ? "The authorization session was invalid or expired. Start again."
          : "Amazon authorization could not be completed. No credentials were stored.",
        "danger",
      );
    window.history.replaceState({}, "", window.location.pathname);
  }, [notify]);
  useEffect(() => {
    document.body.classList.toggle("dialog-open", setupOpen);
    return () => document.body.classList.remove("dialog-open");
  }, [setupOpen]);

  async function connect() {
    if (!status?.oauthAvailable) {
      setSetupOpen(true);
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
        kicker="Connected commerce"
        title="Amazon integration"
        description="Bring your professional seller account into one secure research workspace."
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
      <Card
        className={
          connected
            ? "amazon-connect-hero amazon-connect-hero--connected"
            : "amazon-connect-hero"
        }
      >
        <div className="amazon-connect-hero__ambient" aria-hidden="true" />
        <div className="amazon-connect-hero__identity">
          <div className="amazon-connect-hero__mark" aria-hidden="true">
            <span>a</span>
            <i />
          </div>
          <div className="amazon-connect-hero__copy">
            <div className="badge-stack">
              <Badge tone={state.tone}>{state.label}</Badge>
              {status?.localDemo ? (
                <Badge tone="info">Demo workspace active</Badge>
              ) : null}
            </div>
            <span className="eyebrow">Amazon Selling Partner API</span>
            <h2>
              {connected
                ? "Your professional seller account is connected"
                : "Connect your Amazon seller account"}
            </h2>
            <p>
              {connected
                ? "RizPoint is receiving authorized, tenant-scoped Amazon evidence for your connected marketplaces."
                : "Authorize RizPoint once, then research catalog products, competitive offers, fees, and selling eligibility with real Amazon evidence."}
            </p>
            <div className="amazon-trust-row">
              <span>
                <LockKeyhole aria-hidden="true" /> Encrypted credentials
              </span>
              <span>
                <ShieldCheck aria-hidden="true" /> Read-only research
              </span>
              <span>
                <DatabaseZap aria-hidden="true" /> Persisted evidence
              </span>
            </div>
          </div>
        </div>
        <div className="amazon-connect-hero__panel">
          {connected ? (
            <>
              <div className="amazon-live-pulse">
                <i aria-hidden="true" />
                <span>
                  <strong>Live Amazon data layer</strong>
                  <small>
                    {status?.connection?.marketplaces.filter(
                      (marketplace) => marketplace.isParticipating,
                    ).length ?? 0}{" "}
                    marketplace(s) available
                  </small>
                </span>
              </div>
              <Button
                variant="secondary"
                onClick={() => void action("TEST_CONNECTION")}
                loading={busy === "TEST_CONNECTION"}
              >
                <RefreshCw aria-hidden="true" /> Test connection
              </Button>
            </>
          ) : (
            <>
              <div>
                <span className="amazon-connect-label">Start in</span>
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
              </div>
              <Button
                className="amazon-connect-primary"
                onClick={() => void connect()}
                loading={busy === "connect"}
              >
                <ShoppingBag aria-hidden="true" />
                Connect professional seller account
                <ArrowRight aria-hidden="true" />
              </Button>
              <small>
                {status?.oauthAvailable
                  ? "You will continue to Amazon to approve access."
                  : "One-time private app activation is required before Amazon can open."}
              </small>
            </>
          )}
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

          {connected ? (
            <>
              <div className="amazon-summary-grid">
                <Card>
                  <span>Seller account</span>
                  <strong>
                    {status.connection?.sellerIdentity ?? "Connected seller"}
                  </strong>
                </Card>
                <Card>
                  <span>Region</span>
                  <strong>{status.connection?.region ?? "—"}</strong>
                </Card>
                <Card>
                  <span>Connected since</span>
                  <strong>
                    {dateTime(status.connection?.connectedAt ?? null)}
                  </strong>
                </Card>
                <Card>
                  <span>Last healthy check</span>
                  <strong>
                    {dateTime(
                      status.connection?.lastSuccessfulValidation ?? null,
                    )}
                  </strong>
                </Card>
              </div>

              <Card className="amazon-actions-card">
                <div>
                  <span className="eyebrow">Connection controls</span>
                  <h2>Keep your Amazon data layer healthy</h2>
                  <p>
                    Validation runs safely in the background. Existing evidence
                    is preserved if Amazon is unavailable.
                  </p>
                </div>
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
                    onClick={() => void action("REFRESH_CAPABILITIES")}
                    loading={busy === "REFRESH_CAPABILITIES"}
                  >
                    <Zap aria-hidden="true" /> Refresh capabilities
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void disconnect()}
                    loading={busy === "disconnect"}
                  >
                    Disconnect locally
                  </Button>
                </div>
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
            </>
          ) : (
            <div className="amazon-preconnect-grid">
              <Card className="amazon-connect-steps">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">How it works</span>
                    <h2>From approval to live research in minutes</h2>
                  </div>
                  <Badge tone={status.oauthAvailable ? "success" : "warning"}>
                    {status.oauthAvailable
                      ? "Ready to connect"
                      : "Activation needed"}
                  </Badge>
                </div>
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Sign in securely with Amazon</strong>
                      <p>
                        RizPoint sends you to Amazon. Your password never
                        touches this application.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Approve your seller account</strong>
                      <p>
                        Amazon returns a short-lived authorization code through
                        the verified callback.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Start researching live evidence</strong>
                      <p>
                        RizPoint discovers marketplaces, validates capabilities,
                        and stores the refresh token encrypted.
                      </p>
                    </div>
                  </li>
                </ol>
              </Card>
              <Card className="amazon-access-preview">
                <span className="eyebrow">Included with Amazon</span>
                <h2>What becomes available</h2>
                <div>
                  <span>
                    <Store aria-hidden="true" />
                    <strong>Catalog products</strong>
                    <small>ASIN, barcode, and keyword catalog search</small>
                  </span>
                  <span>
                    <ShoppingBag aria-hidden="true" />
                    <strong>Competitive offers</strong>
                    <small>Current offer evidence when Amazon returns it</small>
                  </span>
                  <span>
                    <DatabaseZap aria-hidden="true" />
                    <strong>Fees & eligibility</strong>
                    <small>Scenario-bound fees and seller restrictions</small>
                  </span>
                </div>
                <p>
                  Historical demand, keyword volume, and reverse-ASIN ranks
                  still require separate licensed providers.
                </p>
              </Card>
            </div>
          )}

          {connected ? (
            <>
              <Card className="amazon-marketplaces-card">
                <div className="section-heading">
                  <div>
                    <h2>Connected marketplaces</h2>
                    <p>
                      Discovered from Sellers API marketplace participations.
                    </p>
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
                    <p>
                      Availability can differ by marketplace and granted role.
                    </p>
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
                                    item.marketplaceId ===
                                    capability.marketplaceId,
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
                      No unsupported metric will be presented as live Amazon
                      data.
                    </span>
                  </div>
                )}
              </Card>
            </>
          ) : null}

          <Card className="amazon-private-option">
            <div>
              <span className="amazon-private-option__icon">
                <KeyRound aria-hidden="true" />
              </span>
              <span>
                <strong>Using a private SP-API application?</strong>
                <small>
                  Keep the refresh token out of the browser with secure
                  server-side self-authorization.
                </small>
              </span>
            </div>
            <Button variant="secondary" onClick={() => setSetupOpen(true)}>
              View secure setup <ArrowRight aria-hidden="true" />
            </Button>
          </Card>

          {setupOpen ? (
            <div
              className="amazon-setup-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setSetupOpen(false);
              }}
            >
              <section
                className="amazon-setup-drawer"
                role="dialog"
                aria-modal="true"
                aria-labelledby="amazon-private-setup-title"
              >
                <header>
                  <div>
                    <span className="eyebrow">Private owner connection</span>
                    <h2 id="amazon-private-setup-title">
                      Secure self-authorization
                    </h2>
                    <p>
                      Complete this once on the RizPoint server. Credentials
                      never enter browser storage, URLs, or client-side state.
                    </p>
                  </div>
                  <Button
                    variant="quiet"
                    aria-label="Close secure Amazon setup"
                    onClick={() => setSetupOpen(false)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </header>
                <ol className="amazon-private-steps">
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Locate the private SP-API application</strong>
                      <p>
                        In Solution Provider Portal, confirm Product Listing and
                        Pricing roles and view the LWA credentials.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Authorize the Seller Central account</strong>
                      <p>
                        As the Primary User, authorize the app and securely
                        capture the refresh token.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Prepare the owner-only environment</strong>
                      <p>
                        Follow <code>docs/AMAZON_CONNECTION.md</code>. Never use
                        web settings or <code>NEXT_PUBLIC_*</code> variables.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>4</span>
                    <div>
                      <strong>Connect and encrypt</strong>
                      <p>
                        Run <code>pnpm sp-api:connect</code>. RizPoint validates
                        Amazon, encrypts the refresh token, and discovers
                        marketplaces.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>5</span>
                    <div>
                      <strong>Return to this workspace</strong>
                      <p>
                        The status updates automatically. Test the connection
                        and review each proven capability.
                      </p>
                    </div>
                  </li>
                </ol>
                <footer>
                  <ShieldCheck aria-hidden="true" />
                  <span>
                    <strong>Security boundary</strong>
                    <small>
                      Access tokens stay in worker memory. Refresh tokens are
                      encrypted at rest and never returned by an API.
                    </small>
                  </span>
                </footer>
              </section>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
