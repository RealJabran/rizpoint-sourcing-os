import { describe, expect, it } from "vitest";
import {
  apiRateLimitPrincipalHash,
  apiRateLimitWindow,
} from "../src/repositories/api-rate-limit.js";

describe("API rate-limit policy", () => {
  it("uses deterministic fixed windows and one-way principal hashes", () => {
    expect(
      apiRateLimitWindow({
        now: new Date("2026-08-19T12:00:59.900Z"),
        windowSeconds: 60,
      }),
    ).toEqual({
      windowStart: new Date("2026-08-19T12:00:00.000Z"),
      expiresAt: new Date("2026-08-19T12:01:00.000Z"),
    });
    const hash = apiRateLimitPrincipalHash("Bearer private-token");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("private-token");
  });
});
