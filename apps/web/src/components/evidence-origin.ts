export type EvidenceOriginLabel =
  | "STORED AMAZON"
  | "LICENSED PROVIDER"
  | "USER INPUT"
  | "DERIVED"
  | "MOCK"
  | "SOURCE PROVIDED";

/** UI records are persisted evidence by the time they reach React. This
 * classifier prevents an amazon-sp-api source string from implying a live
 * request occurred during page rendering. */
export function evidenceOrigin(
  source: string | null | undefined,
): EvidenceOriginLabel {
  const normalized = source?.trim().toLowerCase() ?? "";
  if (normalized.includes("mock") || normalized.includes("fixture"))
    return "MOCK";
  if (
    normalized.includes("amazon-sp-api") ||
    normalized.includes("amazon selling partner") ||
    normalized.includes("amazon sp-api")
  )
    return "STORED AMAZON";
  if (
    normalized.includes("user") ||
    normalized.includes("manual") ||
    normalized.includes("import")
  )
    return "USER INPUT";
  if (
    normalized.includes("derived") ||
    normalized.includes("deterministic") ||
    normalized.includes("rizpoint") ||
    normalized.includes("modeled")
  )
    return "DERIVED";
  if (normalized.includes("keepa") || normalized.includes("provider"))
    return "LICENSED PROVIDER";
  return "SOURCE PROVIDED";
}
