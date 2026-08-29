import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";

export const STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  MANUAL: "MANUAL_VERIFICATION_REQUIRED",
});

export const BROWSER_FORBIDDEN_SECRET_MARKERS = Object.freeze([
  "DATABASE_URL",
  "DATABASE_PASSWORD",
  "POSTGRES_PASSWORD",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
  "PROVIDER_CREDENTIAL_KEY_V1",
  "SP_API_LWA_CLIENT_SECRET",
  "SP_API_REFRESH_TOKEN",
  "SP_API_OAUTH_CALLBACK_PRIVATE_KEY",
  "S3_SECRET",
  "S3_SECRET_KEY",
  "MFA_CREDENTIAL_KEY_V1",
  "MFA_ENCRYPTION_KEY",
  "KEEPA_API_KEY",
]);

export const EXTERNAL_PORTS_TO_PROBE = Object.freeze([
  22, 80, 443, 3000, 3001, 3310, 5432, 6379, 8000, 9000, 9001, 9090,
]);

const PLACEHOLDER = /replace-with|change-?me|example|placeholder|^$/i;
const AMAZON_ENDPOINTS = new Set([
  "https://sellingpartnerapi-na.amazon.com",
  "https://sellingpartnerapi-eu.amazon.com",
  "https://sellingpartnerapi-fe.amazon.com",
]);

const EXTERNAL_CONTROLS = Object.freeze({
  hostFirewall: { label: "Host/cloud firewall", maxAgeDays: 90 },
  waf: { label: "Internet-edge WAF", maxAgeDays: 90 },
  idsIps: { label: "IDS/IPS", maxAgeDays: 90 },
  endpointProtection: {
    label: "Server and endpoint anti-malware",
    maxAgeDays: 31,
  },
  storageEncryption: {
    label: "Database, volume, object and log encryption",
    maxAgeDays: 90,
  },
  backupEncryption: { label: "Encrypted backups", maxAgeDays: 90 },
  centralizedMonitoring: {
    label: "Centralized monitoring/SIEM",
    maxAgeDays: 90,
  },
  securityUpdates: {
    label: "Operating-system and endpoint security updates",
    maxAgeDays: 31,
  },
});

function result(id, status, detail) {
  return { id, status, detail };
}

function serviceNetworks(service) {
  if (!service?.networks) return [];
  return Array.isArray(service.networks)
    ? service.networks
    : Object.keys(service.networks);
}

function hasNetwork(service, expected) {
  return serviceNetworks(service).some(
    (name) => name === expected || name.endsWith(`-${expected}`),
  );
}

function publishedPorts(service) {
  return (service?.ports ?? []).map((port) => ({
    target: Number(port.target),
    published: Number(port.published),
    protocol: port.protocol ?? "tcp",
  }));
}

function checkNetworkMembership(checks, services, serviceName, required) {
  const service = services[serviceName];
  if (!service) {
    checks.push(
      result(
        `compose-service-${serviceName}`,
        STATUS.FAIL,
        `Required production service ${serviceName} is missing.`,
      ),
    );
    return;
  }
  const missing = required.filter((network) => !hasNetwork(service, network));
  const unexpected = serviceNetworks(service).filter(
    (actual) =>
      !required.some(
        (expected) => actual === expected || actual.endsWith(`-${expected}`),
      ),
  );
  const valid = missing.length === 0 && unexpected.length === 0;
  checks.push(
    result(
      `compose-networks-${serviceName}`,
      valid ? STATUS.PASS : STATUS.FAIL,
      valid
        ? `${serviceName} is attached only through its required trust zones.`
        : `${serviceName} network mismatch; missing=${missing.join(",") || "none"}, unexpected=${unexpected.join(",") || "none"}.`,
    ),
  );
}

export function evaluateProductionCompose(compose) {
  const checks = [];
  const services = compose?.services ?? {};
  const networks = compose?.networks ?? {};

  for (const name of ["edge", "application", "data", "security"]) {
    const found = Object.entries(networks).find(
      ([key, value]) =>
        key === name || key.endsWith(`-${name}`) || value?.name?.endsWith(name),
    );
    checks.push(
      result(
        `compose-network-${name}`,
        found ? STATUS.PASS : STATUS.FAIL,
        found
          ? `${name.toUpperCase()} trust zone is declared.`
          : `${name.toUpperCase()} trust zone is missing.`,
      ),
    );
  }

  checkNetworkMembership(checks, services, "edge", ["edge"]);
  checkNetworkMembership(checks, services, "web", ["edge", "data"]);
  checkNetworkMembership(checks, services, "worker", [
    "application",
    "data",
    "security",
  ]);
  checkNetworkMembership(checks, services, "migrate", ["data"]);
  checkNetworkMembership(checks, services, "scanner", ["security"]);
  checkNetworkMembership(checks, services, "clamav", [
    "security",
    "security-updates",
  ]);

  const published = Object.entries(services).flatMap(([serviceName, service]) =>
    publishedPorts(service).map((port) => ({ serviceName, ...port })),
  );
  const unexpected = published.filter(
    (port) =>
      port.serviceName !== "edge" ||
      port.published !== 443 ||
      port.target !== 8443 ||
      port.protocol !== "tcp",
  );
  checks.push(
    result(
      "compose-public-ports",
      published.length === 1 && unexpected.length === 0
        ? STATUS.PASS
        : STATUS.FAIL,
      published.length === 1 && unexpected.length === 0
        ? "Only edge TCP/443 is published; internal services have no host ports."
        : `Unexpected published ports: ${JSON.stringify(published)}.`,
    ),
  );

  const unsafe = Object.entries(services).filter(
    ([, service]) =>
      service?.privileged === true ||
      service?.network_mode === "host" ||
      (service?.volumes ?? []).some((volume) =>
        String(volume?.source ?? volume).includes("/var/run/docker.sock"),
      ),
  );
  checks.push(
    result(
      "compose-host-isolation",
      unsafe.length === 0 ? STATUS.PASS : STATUS.FAIL,
      unsafe.length === 0
        ? "No production service uses host networking, privileged mode, or the Docker socket."
        : `Unsafe host access: ${unsafe.map(([name]) => name).join(", ")}.`,
    ),
  );

  const hardenedServices = ["edge", "web", "worker", "migrate", "scanner"];
  const notHardened = hardenedServices.filter((name) => {
    const service = services[name];
    const securityOptions = service?.security_opt ?? [];
    return (
      !service?.read_only ||
      !(service?.cap_drop ?? []).includes("ALL") ||
      !securityOptions.some((option) =>
        String(option).startsWith("no-new-privileges"),
      )
    );
  });
  checks.push(
    result(
      "compose-container-hardening",
      notHardened.length === 0 ? STATUS.PASS : STATUS.FAIL,
      notHardened.length === 0
        ? "Application containers are read-only, capability-dropped, and no-new-privileges."
        : `Container hardening missing for: ${notHardened.join(", ")}.`,
    ),
  );

  const webEnvironment = services.web?.environment ?? {};
  const workerEnvironment = services.worker?.environment ?? {};
  const fixedEnvironmentOkay =
    webEnvironment.NODE_ENV === "production" &&
    webEnvironment.RIZPOINT_PRIVATE_MODE === "true" &&
    webEnvironment.PHASE_ZERO_DEMO_MODE === "false" &&
    workerEnvironment.NODE_ENV === "production" &&
    workerEnvironment.RIZPOINT_PRIVATE_MODE === "true" &&
    workerEnvironment.PHASE_ZERO_DEMO_MODE === "false" &&
    String(webEnvironment.NODE_OPTIONS ?? "").includes("--tls-min-v1.2") &&
    String(workerEnvironment.NODE_OPTIONS ?? "").includes("--tls-min-v1.2");
  checks.push(
    result(
      "compose-fail-closed-runtime",
      fixedEnvironmentOkay ? STATUS.PASS : STATUS.FAIL,
      fixedEnvironmentOkay
        ? "Private production, demo rejection, and Node TLS 1.2 minimum are fixed in the profile."
        : "Production/private/demo/TLS runtime flags are not fixed safely.",
    ),
  );

  const webHasUnneededAccess =
    Object.hasOwn(webEnvironment, "REDIS_URL") ||
    Object.hasOwn(webEnvironment, "SCANNER_BASE_URL") ||
    Object.hasOwn(webEnvironment, "SP_API_LWA_CLIENT_SECRET") ||
    Object.hasOwn(webEnvironment, "PROVIDER_CREDENTIAL_KEY_V1");
  checks.push(
    result(
      "compose-web-least-connectivity",
      webHasUnneededAccess ? STATUS.FAIL : STATUS.PASS,
      webHasUnneededAccess
        ? "Web receives a worker/scanner/provider-only configuration value."
        : "Web receives no Redis, scanner, LWA secret, or provider-vault configuration.",
    ),
  );

  return checks;
}

function validHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function strongValue(value, minimumLength = 32) {
  return (
    typeof value === "string" &&
    value.length >= minimumLength &&
    !PLACEHOLDER.test(value)
  );
}

function base64KeyIs256Bits(value) {
  if (!strongValue(value, 40)) return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

function postgresVerifyFull(value) {
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.searchParams.get("sslmode") === "verify-full"
    );
  } catch {
    return false;
  }
}

function safeScannerEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && url.hostname === "scanner";
  } catch {
    return false;
  }
}

export function evaluateRuntimeEnvironment(environment) {
  const checks = [];
  checks.push(
    result(
      "runtime-private-production",
      environment.NODE_ENV === "production" &&
        environment.RIZPOINT_PRIVATE_MODE === "true" &&
        environment.PHASE_ZERO_DEMO_MODE === "false"
        ? STATUS.PASS
        : STATUS.FAIL,
      "Production must be private and demo mode must be disabled.",
    ),
  );
  checks.push(
    result(
      "runtime-tls-minimum",
      String(environment.NODE_OPTIONS ?? "").includes("--tls-min-v1.2")
        ? STATUS.PASS
        : STATUS.FAIL,
      "Node outbound TLS must set --tls-min-v1.2.",
    ),
  );

  for (const name of [
    "NEXTAUTH_URL",
    "NEXT_PUBLIC_APP_URL",
    "S3_ENDPOINT",
    "S3_PUBLIC_ENDPOINT",
    "RIZPOINT_ERROR_TRACKING_WEBHOOK_URL",
  ]) {
    checks.push(
      result(
        `runtime-https-${name.toLowerCase()}`,
        validHttps(environment[name]) ? STATUS.PASS : STATUS.FAIL,
        `${name} must be an HTTPS URL.`,
      ),
    );
  }

  if (environment.SP_API_OAUTH_REDIRECT_URI) {
    checks.push(
      result(
        "runtime-oauth-callback-https",
        validHttps(environment.SP_API_OAUTH_REDIRECT_URI)
          ? STATUS.PASS
          : STATUS.FAIL,
        "The Amazon OAuth callback must use HTTPS.",
      ),
    );
  }
  if (environment.SP_API_ENDPOINT) {
    const normalized = String(environment.SP_API_ENDPOINT).replace(/\/$/, "");
    checks.push(
      result(
        "runtime-sp-api-endpoint",
        AMAZON_ENDPOINTS.has(normalized) ? STATUS.PASS : STATUS.FAIL,
        "SP_API_ENDPOINT must be a current allowlisted HTTPS Amazon endpoint.",
      ),
    );
  }

  checks.push(
    result(
      "runtime-database-tls",
      postgresVerifyFull(environment.DATABASE_URL) ? STATUS.PASS : STATUS.FAIL,
      "PostgreSQL must use sslmode=verify-full in the supported production profile.",
    ),
  );
  checks.push(
    result(
      "runtime-redis-tls",
      (() => {
        try {
          return new URL(environment.REDIS_URL).protocol === "rediss:"
            ? STATUS.PASS
            : STATUS.FAIL;
        } catch {
          return STATUS.FAIL;
        }
      })(),
      "Redis must use rediss://.",
    ),
  );
  checks.push(
    result(
      "runtime-scanner-boundary",
      safeScannerEndpoint(environment.SCANNER_BASE_URL)
        ? STATUS.PASS
        : STATUS.FAIL,
      "Scanner must use HTTPS or the isolated scanner service name without URL credentials/query data.",
    ),
  );

  for (const [name, minimum] of [
    ["NEXTAUTH_SECRET", 32],
    ["SP_API_LWA_CLIENT_SECRET", 20],
    ["S3_SECRET_KEY", 20],
  ]) {
    checks.push(
      result(
        `runtime-secret-${name.toLowerCase()}`,
        strongValue(environment[name], minimum) ? STATUS.PASS : STATUS.FAIL,
        `${name} must be injected, non-placeholder, and at least ${minimum} characters.`,
      ),
    );
  }
  for (const name of ["MFA_CREDENTIAL_KEY_V1", "PROVIDER_CREDENTIAL_KEY_V1"]) {
    checks.push(
      result(
        `runtime-key-${name.toLowerCase()}`,
        base64KeyIs256Bits(environment[name]) ? STATUS.PASS : STATUS.FAIL,
        `${name} must be an injected 256-bit base64 key.`,
      ),
    );
  }

  const encryptionMode = environment.S3_SERVER_SIDE_ENCRYPTION;
  const storageEncrypted =
    encryptionMode === "AES256" ||
    (encryptionMode === "aws:kms" && strongValue(environment.S3_KMS_KEY_ID, 8));
  checks.push(
    result(
      "runtime-object-encryption",
      storageEncrypted ? STATUS.PASS : STATUS.FAIL,
      "Object storage must use AES256 or an explicit managed KMS key.",
    ),
  );

  return checks;
}

export function evaluateStaticFiles({ nginx, nextConfig, csp, privateAsset }) {
  const checks = [];
  const nginxRequirements = [
    "listen 8443 ssl",
    "ssl_protocols TLSv1.2 TLSv1.3",
    "return 308 https://$host$request_uri",
    "Strict-Transport-Security",
    "/run/secrets/rizpoint_tls_cert",
    "/run/secrets/rizpoint_tls_key",
  ];
  const missingNginx = nginxRequirements.filter(
    (required) => !nginx.includes(required),
  );
  checks.push(
    result(
      "edge-tls-configuration",
      missingNginx.length === 0 ? STATUS.PASS : STATUS.FAIL,
      missingNginx.length === 0
        ? "TLS edge supports only TLS 1.2/1.3, redirects HTTP, and loads external certificate secrets."
        : `TLS edge is missing: ${missingNginx.join(", ")}.`,
    ),
  );

  const headerRequirements = [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "X-Frame-Options",
  ];
  const missingHeaders = headerRequirements.filter(
    (header) => !nextConfig.includes(header),
  );
  checks.push(
    result(
      "application-security-headers",
      missingHeaders.length === 0 && csp.includes("frame-ancestors 'none'")
        ? STATUS.PASS
        : STATUS.FAIL,
      missingHeaders.length === 0
        ? "Application security headers and CSP clickjacking protection are configured."
        : `Application headers missing: ${missingHeaders.join(", ")}.`,
    ),
  );

  const missingMarkers = BROWSER_FORBIDDEN_SECRET_MARKERS.filter(
    (marker) => !privateAsset.includes(`"${marker}"`),
  );
  checks.push(
    result(
      "browser-secret-markers",
      missingMarkers.length === 0 ? STATUS.PASS : STATUS.FAIL,
      missingMarkers.length === 0
        ? "Browser artifact scanning covers all Prompt 36H secret markers."
        : `Browser artifact scan missing markers: ${missingMarkers.join(", ")}.`,
    ),
  );
  return checks;
}

export function evaluateAttestation(attestation, now = new Date()) {
  return Object.entries(EXTERNAL_CONTROLS).map(([key, policy]) => {
    const value = attestation?.controls?.[key];
    if (!value || value.status === "NOT_VERIFIED")
      return result(
        `external-${key}`,
        STATUS.MANUAL,
        `${policy.label} needs a dated operator verification record.`,
      );
    if (value.status !== "VERIFIED")
      return result(
        `external-${key}`,
        STATUS.FAIL,
        `${policy.label} is explicitly failed or has an invalid status.`,
      );
    const verifiedAt = new Date(value.verifiedAt ?? "invalid");
    const ageMs = now.getTime() - verifiedAt.getTime();
    const complete =
      Number.isFinite(verifiedAt.getTime()) &&
      ageMs >= 0 &&
      ageMs <= policy.maxAgeDays * 86_400_000 &&
      typeof value.reviewer === "string" &&
      value.reviewer.trim().length >= 3 &&
      typeof value.evidenceReference === "string" &&
      value.evidenceReference.trim().length >= 3;
    return result(
      `external-${key}`,
      complete ? STATUS.PASS : STATUS.MANUAL,
      complete
        ? `${policy.label} verified ${verifiedAt.toISOString()} with an external evidence reference.`
        : `${policy.label} verification is incomplete or older than ${policy.maxAgeDays} days.`,
    );
  });
}

export function loadProductionCompose(path = "compose.production.yaml") {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      "/dev/null",
      "-f",
      path,
      "config",
      "--format",
      "json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        RIZPOINT_TLS_CERT_FILE:
          process.env.RIZPOINT_TLS_CERT_FILE ??
          "/run/rizpoint/tls/fullchain.pem",
        RIZPOINT_TLS_KEY_FILE:
          process.env.RIZPOINT_TLS_KEY_FILE ?? "/run/rizpoint/tls/privkey.pem",
        S3_PUBLIC_ENDPOINT:
          process.env.S3_PUBLIC_ENDPOINT ?? "https://storage.invalid",
        COMPOSE_DISABLE_ENV_FILE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output);
}

export async function loadAttestation(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function summarize(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { [STATUS.PASS]: 0, [STATUS.FAIL]: 0, [STATUS.MANUAL]: 0 },
  );
}

export async function verifyPublicTlsEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return [result("live-public-tls", STATUS.FAIL, "Public URL is invalid.")];
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    return [
      result(
        "live-public-tls",
        STATUS.FAIL,
        "Public verification URL must be HTTPS and contain no credentials or fragment.",
      ),
    ];
  if (url.pathname === "/") url.pathname = "/api/health";

  return new Promise((resolve) => {
    const request = httpsRequest(
      url,
      { method: "GET", minVersion: "TLSv1.2", timeout: 7_500 },
      (response) => {
        const protocol = response.socket.getProtocol();
        const tlsOkay = protocol === "TLSv1.2" || protocol === "TLSv1.3";
        const requiredHeaders = [
          "strict-transport-security",
          "content-security-policy",
          "x-content-type-options",
          "referrer-policy",
          "permissions-policy",
          "x-frame-options",
        ];
        const missing = requiredHeaders.filter(
          (header) => !response.headers[header],
        );
        response.resume();
        response.once("end", () =>
          resolve([
            result(
              "live-public-tls",
              tlsOkay && (response.statusCode ?? 500) < 500
                ? STATUS.PASS
                : STATUS.FAIL,
              tlsOkay
                ? `Validated certificate and negotiated ${protocol}.`
                : "Endpoint did not negotiate TLS 1.2 or TLS 1.3.",
            ),
            result(
              "live-public-security-headers",
              missing.length === 0 ? STATUS.PASS : STATUS.FAIL,
              missing.length === 0
                ? "Live public response includes all required security headers."
                : `Live response is missing: ${missing.join(", ")}.`,
            ),
          ]),
        );
      },
    );
    request.once("timeout", () => request.destroy(new Error("timeout")));
    request.once("error", (error) =>
      resolve([
        result(
          "live-public-tls",
          STATUS.FAIL,
          `Live TLS verification failed: ${error.code ?? error.name}.`,
        ),
      ]),
    );
    request.end();
  });
}
