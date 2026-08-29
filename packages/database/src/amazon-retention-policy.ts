/**
 * RizPoint's conservative internal ceiling for non-restricted Amazon SP-API
 * information. Amazon's current DPP is purpose/deletion-event based; this
 * additional ceiling ensures ordinary research observations are not retained
 * indefinitely. Calendar arithmetic is deliberately used instead of 548 days.
 */
export const AMAZON_INFORMATION_MAX_RETENTION_MONTHS = 18;
export const AMAZON_DELETION_DEADLINE_DAYS = 30;
export const AMAZON_PROVIDER_KEYS = new Set([
  "amazon-sp-api",
  "amazon_sp_api",
  "AMAZON_SP_API",
]);

export function isAmazonProviderKey(providerKey: string): boolean {
  return AMAZON_PROVIDER_KEYS.has(providerKey);
}

export function addUtcCalendarMonths(value: Date, months: number): Date {
  if (!Number.isInteger(months)) throw new Error("CALENDAR_MONTHS_INVALID");
  const result = new Date(value);
  if (Number.isNaN(result.valueOf())) throw new Error("DATE_INVALID");
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const finalDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, finalDay));
  return result;
}

export function addUtcCalendarDays(value: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 0)
    throw new Error("CALENDAR_DAYS_INVALID");
  const result = new Date(value);
  if (Number.isNaN(result.valueOf())) throw new Error("DATE_INVALID");
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function amazonRetentionDeadline(input: {
  observedAt: Date;
  requestedRetainUntil?: Date;
  shorterContractualRetentionDays?: number;
}): Date {
  const candidates = [
    addUtcCalendarMonths(
      input.observedAt,
      AMAZON_INFORMATION_MAX_RETENTION_MONTHS,
    ),
  ];
  if (input.requestedRetainUntil)
    candidates.push(new Date(input.requestedRetainUntil));
  if (input.shorterContractualRetentionDays !== undefined) {
    if (
      !Number.isInteger(input.shorterContractualRetentionDays) ||
      input.shorterContractualRetentionDays < 1
    )
      throw new Error("PROVIDER_RETENTION_DAYS_INVALID");
    candidates.push(
      addUtcCalendarDays(
        input.observedAt,
        input.shorterContractualRetentionDays,
      ),
    );
  }
  return candidates.reduce((earliest, candidate) =>
    candidate < earliest ? candidate : earliest,
  );
}

export function amazonDeletionDeadline(detectedAt: Date): Date {
  return addUtcCalendarDays(detectedAt, AMAZON_DELETION_DEADLINE_DAYS);
}
