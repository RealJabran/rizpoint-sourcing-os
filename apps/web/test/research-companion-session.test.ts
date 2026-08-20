import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createResearchCompanionSession,
  verifyResearchCompanionSession,
} from "../src/research-companion-session.js";

describe("Research Companion session", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("binds a short-lived token to its audience and organization", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "a-long-test-only-session-secret-value");
    const created = createResearchCompanionSession("org-1");
    expect(verifyResearchCompanionSession(created.token)).toMatchObject({
      version: 1,
      audience: "rizpoint-research-companion",
      organizationId: "org-1",
    });
    expect(verifyResearchCompanionSession(`${created.token}x`)).toBeNull();
    expect(verifyResearchCompanionSession("x".repeat(4_097))).toBeNull();
  });

  it("does not use the demo access token as a production signing key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("RIZPOINT_PRIVATE_ACCESS_TOKEN", "demo-token");
    expect(() => createResearchCompanionSession("org-1")).toThrow(
      "RESEARCH_COMPANION_SESSION_SECRET_UNAVAILABLE",
    );
  });
});
