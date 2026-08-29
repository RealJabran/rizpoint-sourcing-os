import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionConfiguration } from "../src/runtime-config.js";

function validProductionEnvironment() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NODE_OPTIONS", "--tls-min-v1.2");
  vi.stubEnv("RIZPOINT_PRIVATE_MODE", "true");
  vi.stubEnv("PHASE_ZERO_DEMO_MODE", "false");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://user:password@db/rizpoint?sslmode=verify-full",
  );
  vi.stubEnv("S3_ENDPOINT", "https://storage.test");
  vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://storage-public.test");
  vi.stubEnv("S3_BUCKET", "bucket");
  vi.stubEnv("S3_ACCESS_KEY", "key");
  vi.stubEnv("S3_SECRET_KEY", "test-only-secret");
  vi.stubEnv("NEXTAUTH_SECRET", "a-very-long-private-session-secret-value");
  vi.stubEnv("NEXTAUTH_URL", "https://private.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://private.test");
  vi.stubEnv("RIZPOINT_PRIVATE_ORGANIZATION_SLUG", "private");
  vi.stubEnv("MFA_CREDENTIAL_KEY_V1", Buffer.alloc(32, 4).toString("base64"));
  vi.stubEnv("MALWARE_SCAN_MODE", "clamav");
  vi.stubEnv("S3_SERVER_SIDE_ENCRYPTION", "AES256");
  vi.stubEnv("S3_VERSIONING_ENABLED", "true");
  vi.stubEnv("S3_LIFECYCLE_MANAGED", "true");
  vi.stubEnv("SP_API_ENDPOINT", "https://sellingpartnerapi-na.amazon.com");
}

describe("production configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed for private production with placeholder values", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIZPOINT_PRIVATE_MODE", "true");
    vi.stubEnv("DATABASE_URL", "replace-with-db");
    expect(() => assertProductionConfiguration()).toThrow(
      "production_configuration_invalid",
    );
  });

  it("rejects weak secrets and plaintext production dependencies", () => {
    validProductionEnvironment();
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@db/rizpoint");
    expect(() => assertProductionConfiguration()).toThrow(
      "database_tls_required",
    );
  });

  it("rejects a production MFA encryption key that is not 256 bits", () => {
    validProductionEnvironment();
    vi.stubEnv("MFA_CREDENTIAL_KEY_V1", Buffer.alloc(16, 4).toString("base64"));
    expect(() => assertProductionConfiguration()).toThrow(
      "mfa_credential_key_invalid",
    );
  });

  it("rejects insecure or mismatched production origins", () => {
    validProductionEnvironment();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://private.test");
    expect(() => assertProductionConfiguration()).toThrow(
      "application_origin_mismatch",
    );
  });

  it("rejects unsafe Amazon endpoints and OAuth callbacks", () => {
    validProductionEnvironment();
    vi.stubEnv("SP_API_ENDPOINT", "https://attacker.invalid");
    expect(() => assertProductionConfiguration()).toThrow(
      "sp_api_endpoint_not_allowed",
    );

    vi.stubEnv("SP_API_ENDPOINT", "https://sellingpartnerapi-na.amazon.com");
    vi.stubEnv(
      "SP_API_OAUTH_REDIRECT_URI",
      "http://private.test/api/providers/amazon/oauth/callback",
    );
    expect(() => assertProductionConfiguration()).toThrow(
      "oauth_callback_not_allowed",
    );
  });

  it("accepts the complete fail-closed production configuration", () => {
    validProductionEnvironment();
    expect(() => assertProductionConfiguration()).not.toThrow();
  });

  it("documents every fail-closed production storage endpoint", async () => {
    const template = await readFile(
      new URL("../../../.env.production.example", import.meta.url),
      "utf8",
    );
    expect(template).toMatch(/^S3_PUBLIC_ENDPOINT=/m);
  });

  it("runs the Dockerized web image as an optimized production server", async () => {
    const compose = await readFile(
      new URL("../../../compose.yaml", import.meta.url),
      "utf8",
    );
    const webService = compose.slice(compose.indexOf("  web:"));
    expect(webService).toContain(
      'command: ["node", "apps/web/.next/standalone/apps/web/server.js"]',
    );
    expect(webService).toContain("NODE_ENV: production");
    expect(webService).toContain("HOSTNAME: 0.0.0.0");
    expect(webService).not.toContain('"@rizpoint/web", "dev"');
    expect(webService).toContain('"127.0.0.1:3000:3000"');
    const webDockerfile = await readFile(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );
    const workerDockerfile = await readFile(
      new URL("../../worker/Dockerfile", import.meta.url),
      "utf8",
    );
    expect(webDockerfile).toContain("@rizpoint/database build");
    // The worker imports mock providers transitively. Build its complete
    // workspace dependency graph so image builds cannot retain stale fixture
    // artifacts from an earlier layer.
    expect(workerDockerfile).toContain(
      "pnpm turbo run build --filter=@rizpoint/worker",
    );
  });

  it("does not suppress application hydration warnings", async () => {
    const layout = await readFile(
      new URL("../app/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).not.toContain("suppressHydrationWarning");
  });
});
