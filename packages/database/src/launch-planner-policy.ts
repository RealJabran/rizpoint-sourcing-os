export const LAUNCH_STAGES = [
  "NICHE_APPROVED",
  "SUPPLIER_SAMPLE",
  "COMPLIANCE_VALIDATION",
  "FINAL_COST",
  "BRAND_TRADEMARK_READINESS",
  "PACKAGING_ARTWORK",
  "LISTING_ASSETS",
  "KEYWORD_PLAN",
  "INVENTORY_ORDER",
  "SHIPMENT_FBA",
  "LAUNCH_DATE",
  "ADVERTISING_SETUP",
  "RANK_MARKET_MONITORING",
  "REVIEW_RETURNS_LEARNING",
] as const;
export type LaunchStage = (typeof LAUNCH_STAGES)[number];
export type LaunchStageState =
  "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETE";

export const launchDependencies: Record<LaunchStage, readonly LaunchStage[]> = {
  NICHE_APPROVED: [],
  SUPPLIER_SAMPLE: ["NICHE_APPROVED"],
  COMPLIANCE_VALIDATION: ["SUPPLIER_SAMPLE"],
  FINAL_COST: ["SUPPLIER_SAMPLE", "COMPLIANCE_VALIDATION"],
  BRAND_TRADEMARK_READINESS: ["NICHE_APPROVED"],
  PACKAGING_ARTWORK: ["COMPLIANCE_VALIDATION", "BRAND_TRADEMARK_READINESS"],
  LISTING_ASSETS: ["PACKAGING_ARTWORK"],
  KEYWORD_PLAN: ["NICHE_APPROVED"],
  INVENTORY_ORDER: ["FINAL_COST", "LISTING_ASSETS", "KEYWORD_PLAN"],
  SHIPMENT_FBA: ["INVENTORY_ORDER"],
  LAUNCH_DATE: ["SHIPMENT_FBA"],
  ADVERTISING_SETUP: ["LISTING_ASSETS", "KEYWORD_PLAN"],
  RANK_MARKET_MONITORING: ["LAUNCH_DATE", "ADVERTISING_SETUP"],
  REVIEW_RETURNS_LEARNING: ["LAUNCH_DATE"],
};

export function canAdvanceLaunchStage(input: {
  target: LaunchStage;
  status: LaunchStageState;
  stageStates: Partial<Record<LaunchStage, LaunchStageState>>;
}) {
  if (input.status === "NOT_STARTED" || input.status === "BLOCKED") return true;
  return launchDependencies[input.target].every(
    (stage) => input.stageStates[stage] === "COMPLETE",
  );
}
