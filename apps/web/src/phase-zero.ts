export function phaseZeroDemoEnabled(): boolean {
  return process.env.PHASE_ZERO_DEMO_MODE === "true";
}
