import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROWSER_FORBIDDEN_SECRET_MARKERS,
  EXTERNAL_CONTROLS,
  STATUS,
  evaluateAttestation,
  evaluateProductionCompose,
  evaluateRuntimeEnvironment,
  evaluateStaticFiles,
  loadProductionCompose,
  verifyAttestationSignature,
  verifyPublicTlsEndpoint,
} from "../../scripts/lib/amazon-deployment-security.mjs";

function validRuntime() {
  return {
    NODE_ENV: "production",
    NODE_OPTIONS: "--tls-min-v1.2",
    RIZPOINT_PRIVATE_MODE: "true",
    PHASE_ZERO_DEMO_MODE: "false",
    NEXTAUTH_URL: "https://rizpoint.test",
    NEXT_PUBLIC_APP_URL: "https://rizpoint.test",
    S3_ENDPOINT: "https://s3.private.test",
    S3_PUBLIC_ENDPOINT: "https://storage.rizpoint.test",
    RIZPOINT_ERROR_TRACKING_WEBHOOK_URL: "https://siem.private.test/events",
    SP_API_OAUTH_REDIRECT_URI:
      "https://rizpoint.test/api/providers/amazon/oauth/callback",
    SP_API_ENDPOINT: "https://sellingpartnerapi-na.amazon.com",
    SP_API_LWA_ENDPOINT: "https://api.amazon.com/auth/o2/token",
    NODE_EXTRA_CA_CERTS: "/run/secrets/rizpoint_internal_ca",
    DATABASE_URL:
      "postgresql://rizpoint:test@db.private/rizpoint?sslmode=verify-full",
    REDIS_URL: "rediss://redis.private:6379",
    SCANNER_BASE_URL: "http://scanner:8000",
    NEXTAUTH_SECRET: "test-only-nextauth-secret-with-adequate-length",
    SP_API_LWA_CLIENT_SECRET: "test-only-lwa-secret-long-enough",
    S3_SECRET_KEY: "test-only-object-secret-long-enough",
    MFA_CREDENTIAL_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
    PROVIDER_CREDENTIAL_KEY_V1: Buffer.alloc(32, 8).toString("base64"),
    S3_SERVER_SIDE_ENCRYPTION: "aws:kms",
    S3_KMS_KEY_ID: "test-kms-key-id",
  };
}

function verifiedAttestation() {
  const value = {
    status: "VERIFIED",
    verifiedAt: "2026-08-28T08:00:00.000Z",
    reviewer: "Security operator",
    evidenceReference: "private-ticket-123",
  };
  return {
    controls: Object.fromEntries(
      Object.keys(EXTERNAL_CONTROLS).map((name) => [name, { ...value }]),
    ),
  };
}

test("supported production topology publishes only the TLS edge", async () => {
  const compose = loadProductionCompose();
  const [
    nginx,
    nextConfig,
    csp,
    privateAsset,
    productionCompose,
    webStunnel,
    hostControls,
    firewall,
    monitoring,
  ] = await Promise.all([
    readFile("deploy/amazon-hardened/nginx.conf", "utf8"),
    readFile("apps/web/next.config.ts", "utf8"),
    readFile("apps/web/src/content-security-policy.ts", "utf8"),
    readFile("scripts/check-private-assets.mjs", "utf8"),
    readFile("compose.production.yaml", "utf8"),
    readFile("deploy/amazon-production/runtime/web-stunnel.conf", "utf8"),
    readFile("deploy/amazon-production/host-controls.sh", "utf8"),
    readFile("deploy/amazon-production/firewall.sh", "utf8"),
    readFile(
      "deploy/amazon-production/monitoring/rsyslog-rizpoint.conf.tpl",
      "utf8",
    ),
  ]);
  const checks = [
    ...evaluateProductionCompose(compose, productionCompose),
    ...evaluateStaticFiles({
      nginx,
      nextConfig,
      csp,
      privateAsset,
      productionCompose,
      webStunnel,
      hostControls,
      firewall,
      monitoring,
    }),
  ];
  assert.deepEqual(
    checks.filter((check) => check.status === STATUS.FAIL),
    [],
  );
});

test("an unintended database or Redis host port fails topology verification", () => {
  const compose = loadProductionCompose();
  compose.services.redis = {
    ports: [{ target: 6379, published: "6379", protocol: "tcp" }],
  };
  const checks = evaluateProductionCompose(compose);
  assert.equal(
    checks.find((check) => check.id === "compose-public-ports")?.status,
    STATUS.FAIL,
  );
});

test("runtime verification rejects demo mode, insecure URLs, unsafe endpoints, and weak secrets", () => {
  const environment = validRuntime();
  assert.deepEqual(
    evaluateRuntimeEnvironment(environment).filter(
      (check) => check.status === STATUS.FAIL,
    ),
    [],
  );

  for (const mutation of [
    { PHASE_ZERO_DEMO_MODE: "true" },
    { NEXTAUTH_URL: "http://rizpoint.test" },
    { DATABASE_URL: "postgresql://db/rizpoint?sslmode=require" },
    { REDIS_URL: "redis://redis.private:6379" },
    { SCANNER_BASE_URL: "http://attacker.invalid/scan" },
    { SP_API_ENDPOINT: "https://attacker.invalid" },
    { NEXTAUTH_SECRET: "replace-with-secret" },
    { MFA_CREDENTIAL_KEY_V1: Buffer.alloc(16).toString("base64") },
  ]) {
    const checks = evaluateRuntimeEnvironment({ ...environment, ...mutation });
    assert.ok(
      checks.some((check) => check.status === STATUS.FAIL),
      `expected failure for ${Object.keys(mutation)[0]}`,
    );
  }
});

test("external controls require current dated evidence rather than a boolean flag", () => {
  assert.ok(
    evaluateAttestation(null).every((check) => check.status === STATUS.MANUAL),
  );
  assert.ok(
    evaluateAttestation(
      verifiedAttestation(),
      new Date("2026-08-28T12:00:00.000Z"),
      true,
    ).every((check) => check.status === STATUS.PASS),
  );
  const stale = verifiedAttestation();
  stale.controls.endpointProtection.verifiedAt = "2026-01-01T00:00:00.000Z";
  assert.equal(
    evaluateAttestation(stale, new Date("2026-08-28T12:00:00.000Z"), true).find(
      (check) => check.id === "external-endpointProtection",
    )?.status,
    STATUS.MANUAL,
  );
});

test("operator evidence must retain a valid detached Ed25519 signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(JSON.stringify(verifiedAttestation()));
  const signature = sign(null, bytes, privateKey);
  assert.equal(verifyAttestationSignature(bytes, signature, publicKey), true);
  assert.equal(
    verifyAttestationSignature(
      Buffer.from(`${bytes.toString()} `),
      signature,
      publicKey,
    ),
    false,
  );
});

test("production transport scan rejects plaintext Redis, storage, and disabled verification", () => {
  const base = {
    nginx: "",
    nextConfig: "",
    csp: "",
    privateAsset: "",
    webStunnel: "",
    hostControls: "",
    firewall: "",
    monitoring: "",
  };
  const checks = evaluateStaticFiles({
    ...base,
    productionCompose:
      "REDIS_URL: redis://cache\nS3_ENDPOINT: http://storage\nrejectUnauthorized=false",
  });
  assert.equal(
    checks.find((check) => check.id === "production-plaintext-rejection")
      ?.status,
    STATUS.FAIL,
  );
});

test("browser leakage denylist covers every Prompt 36H secret family", () => {
  for (const marker of [
    "SP_API_LWA_CLIENT_SECRET",
    "SP_API_REFRESH_TOKEN",
    "PROVIDER_CREDENTIAL_KEY_V1",
    "DATABASE_PASSWORD",
    "S3_SECRET",
    "NEXTAUTH_SECRET",
    "MFA_ENCRYPTION_KEY",
  ])
    assert.ok(BROWSER_FORBIDDEN_SECRET_MARKERS.includes(marker));
});

test("live TLS verification rejects an insecure URL before network access", async () => {
  const checks = await verifyPublicTlsEndpoint("http://public.example");
  assert.equal(checks[0]?.status, STATUS.FAIL);
});
