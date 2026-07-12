import { describe, expect, it, vi } from "vitest";
import { phaseZeroDemoEnabled } from "../src/phase-zero.js";

describe("Phase 0 mock route gate", () => {
  it("requires explicit opt-in", () => {
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "false");
    expect(phaseZeroDemoEnabled()).toBe(false);
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    expect(phaseZeroDemoEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});
