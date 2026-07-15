export function observationFreshness(
  observation: Record<string, unknown>,
): string {
  return String(
    observation.freshnessState ?? observation.freshness_state ?? "UNKNOWN",
  );
}

export function requiredNextActions(reasonCodes: readonly string[]): string[] {
  const actions: Record<string, string> = {
    MATCH_REQUIRED: "Review and accept or reject a catalog match.",
    PACK_OR_MATCH_UNVERIFIED:
      "Verify the product match and sellable-unit pack.",
    MISSING_OR_STALE_EVIDENCE:
      "Refresh the missing or stale provider evidence.",
    CURRENCY_MISMATCH: "Use a route and policy with a compatible currency.",
    APPROVAL_EVIDENCE_REQUIRED: "Obtain seller or brand approval evidence.",
    RESTRICTED_OR_PROHIBITED:
      "Do not purchase unless the restriction is resolved.",
    HARD_CONTRADICTION_MANUAL_OVERRIDE:
      "Resolve the known identity contradiction before purchasing.",
  };
  return [
    ...new Set(
      reasonCodes
        .map((code) => actions[code])
        .filter((action): action is string => Boolean(action)),
    ),
  ];
}
