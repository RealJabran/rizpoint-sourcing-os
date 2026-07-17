import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { assertProductionConfiguration } from "../src/runtime-config.js";

describe("production configuration", () => {
  it("fails closed for private production with placeholder values", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIZPOINT_PRIVATE_MODE", "true");
    vi.stubEnv("DATABASE_URL", "replace-with-db");
    expect(() => assertProductionConfiguration()).toThrow(
      "production_configuration_invalid",
    );
    vi.unstubAllEnvs();
  });

  it("rejects weak secrets and plaintext production dependencies", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIZPOINT_PRIVATE_MODE", "true");
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "false");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@db/rizpoint");
    vi.stubEnv("REDIS_URL", "redis://redis:6379");
    vi.stubEnv("S3_ENDPOINT", "http://storage:9000");
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "http://storage:9000");
    vi.stubEnv("S3_BUCKET", "bucket");
    vi.stubEnv("S3_ACCESS_KEY", "key");
    vi.stubEnv("S3_SECRET_KEY", "secret");
    vi.stubEnv("NEXTAUTH_SECRET", "a-very-long-private-session-secret-value");
    vi.stubEnv("NEXTAUTH_URL", "https://private.test");
    vi.stubEnv("RIZPOINT_PRIVATE_ORGANIZATION_SLUG", "private");
    vi.stubEnv("MALWARE_SCAN_MODE", "clamav");
    vi.stubEnv("S3_SERVER_SIDE_ENCRYPTION", "AES256");
    vi.stubEnv("S3_VERSIONING_ENABLED", "true");
    vi.stubEnv("S3_LIFECYCLE_MANAGED", "true");
    expect(() => assertProductionConfiguration()).toThrow(
      "database_tls_required",
    );
    vi.unstubAllEnvs();
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
