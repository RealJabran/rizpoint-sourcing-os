import { afterEach, describe, expect, it, vi } from "vitest";
import { assertWorkerProductionConfiguration } from "../src/runtime-config.js";

function validEnvironment() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NODE_OPTIONS", "--tls-min-v1.2");
  vi.stubEnv("RIZPOINT_PRIVATE_MODE", "true");
  vi.stubEnv("MALWARE_SCAN_MODE", "clamav");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://user:password@db/rizpoint?sslmode=verify-full",
  );
  vi.stubEnv("REDIS_URL", "rediss://redis:6379");
  vi.stubEnv("SCANNER_BASE_URL", "http://scanner:8000");
  vi.stubEnv("S3_ENDPOINT", "https://storage.private");
  vi.stubEnv("S3_BUCKET", "private");
  vi.stubEnv("S3_ACCESS_KEY", "test-access-key");
  vi.stubEnv("S3_SECRET_KEY", "test-secret-key-value");
  vi.stubEnv("S3_SERVER_SIDE_ENCRYPTION", "AES256");
  vi.stubEnv("S3_VERSIONING_ENABLED", "true");
  vi.stubEnv("S3_LIFECYCLE_MANAGED", "true");
  vi.stubEnv(
    "RIZPOINT_ERROR_TRACKING_WEBHOOK_URL",
    "https://monitoring.private/events",
  );
  vi.stubEnv("PROVIDER_MODE", "mock");
}

describe("worker production network configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts verified TLS dependencies and the isolated scanner service", () => {
    validEnvironment();
    expect(() => assertWorkerProductionConfiguration()).not.toThrow();
  });

  it("rejects plaintext data services and an arbitrary scanner URL", () => {
    validEnvironment();
    vi.stubEnv("REDIS_URL", "redis://redis:6379");
    expect(() => assertWorkerProductionConfiguration()).toThrow(
      "redis_tls_required",
    );

    vi.stubEnv("REDIS_URL", "rediss://redis:6379");
    vi.stubEnv("SCANNER_BASE_URL", "http://attacker.invalid/scan");
    expect(() => assertWorkerProductionConfiguration()).toThrow(
      "scanner_endpoint_not_allowed",
    );
  });

  it("fails closed for an unsafe Amazon endpoint in live mode", () => {
    validEnvironment();
    vi.stubEnv("PROVIDER_MODE", "sp_api");
    vi.stubEnv("SP_API_LWA_CLIENT_ID", "test-client-id");
    vi.stubEnv("SP_API_LWA_CLIENT_SECRET", "test-client-secret-long-enough");
    vi.stubEnv(
      "PROVIDER_CREDENTIAL_KEY_V1",
      Buffer.alloc(32, 8).toString("base64"),
    );
    vi.stubEnv("SP_API_ENDPOINT", "https://attacker.invalid");
    expect(() => assertWorkerProductionConfiguration()).toThrow(
      "sp_api_endpoint_not_allowed",
    );
  });
});
