import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getToken = vi.fn();
const findFirst = vi.fn();

vi.mock("next-auth/jwt", () => ({ getToken }));
vi.mock("@rizpoint/database", () => ({ db: { user: { findFirst } } }));

function productionEnvironment() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RIZPOINT_PRIVATE_MODE", "true");
  vi.stubEnv("PHASE_ZERO_DEMO_MODE", "false");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://user:password@db/rizpoint?sslmode=require",
  );
  vi.stubEnv("REDIS_URL", "rediss://redis:6379");
  vi.stubEnv("S3_ENDPOINT", "https://storage.test");
  vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://storage-public.test");
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
}

describe("private production proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects a production demo-mode misconfiguration before routing", async () => {
    productionEnvironment();
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    const { proxy } = await import("../proxy.js");
    await expect(
      proxy(new NextRequest("https://private.test/api/suppliers")),
    ).rejects.toThrow("production_configuration_invalid:demo_mode");
  });

  it("never permits the local demo bypass in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIZPOINT_PRIVATE_MODE", "false");
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    vi.stubEnv("RIZPOINT_ALLOW_UNAUTHENTICATED_DEMO", "true");
    const { proxy } = await import("../proxy.js");
    await expect(
      proxy(new NextRequest("http://localhost:3000/api/ready")),
    ).rejects.toThrow("production_configuration_invalid:private_mode_required");
  });

  it("permits the demo bypass only with both explicit local flags", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RIZPOINT_PRIVATE_MODE", "false");
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    vi.stubEnv("RIZPOINT_ALLOW_UNAUTHENTICATED_DEMO", "true");
    const { proxy } = await import("../proxy.js");
    const response = await proxy(
      new NextRequest("http://localhost:3000/api/ready"),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects a local demo bypass when either explicit flag is absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RIZPOINT_PRIVATE_MODE", "false");
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    vi.stubEnv("RIZPOINT_ALLOW_UNAUTHENTICATED_DEMO", "false");
    const { proxy } = await import("../proxy.js");
    await expect(
      proxy(new NextRequest("http://localhost:3000/api/ready")),
    ).rejects.toThrow("local_configuration_invalid:demo_flags_required");
  });

  it("rejects a revoked or missing membership session", async () => {
    productionEnvironment();
    getToken.mockResolvedValue({
      sub: "user_1",
      organizationId: "org_1",
      sessionEpoch: 2,
    });
    findFirst.mockResolvedValue(null);
    const { proxy } = await import("../proxy.js");
    const response = await proxy(
      new NextRequest("https://private.test/api/suppliers"),
    );
    expect(response.status).toBe(401);
  });

  it("passes only a currently active membership context", async () => {
    productionEnvironment();
    getToken.mockResolvedValue({
      sub: "user_1",
      organizationId: "org_1",
      sessionEpoch: 2,
    });
    findFirst.mockResolvedValue({ id: "user_1" });
    const { proxy } = await import("../proxy.js");
    const response = await proxy(
      new NextRequest("https://private.test/api/suppliers"),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "user_1",
          sessionEpoch: 2,
        }),
      }),
    );
  });
});
