export function phaseZeroDemoEnabled(): boolean {
  // Kept as a compatibility seam while routes are migrated from the Phase 0
  // name. Production requires both private mode and authenticated proxy access.
  return (
    process.env.PHASE_ZERO_DEMO_MODE === "true" ||
    process.env.RIZPOINT_PRIVATE_MODE === "true"
  );
}

export function isLocalDemoMode(): boolean {
  return process.env.PHASE_ZERO_DEMO_MODE === "true";
}
