export type ProviderMoney = { Amount?: unknown; CurrencyCode?: unknown };

export function providerMoney(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const money = value as ProviderMoney;
  const amount =
    typeof money.Amount === "string" || typeof money.Amount === "number"
      ? String(money.Amount)
      : null;
  const currency =
    typeof money.CurrencyCode === "string" ? money.CurrencyCode : null;
  if (!amount || !/^-?\d+(\.\d+)?$/.test(amount) || currency?.length !== 3)
    return null;
  return { amount, currency };
}

export type NormalizedFeeComponent = {
  feeType: string;
  feeAmount: string;
  finalFee: string;
  currency: string;
  promotion?: string;
  tax?: string;
  parentFeeType?: string;
};

export function normalizeFeeComponents(
  value: unknown,
  parentFeeType?: string,
): { components: NormalizedFeeComponent[]; complete: boolean } {
  if (!Array.isArray(value)) return { components: [], complete: false };
  const components: NormalizedFeeComponent[] = [];
  let complete = true;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      complete = false;
      continue;
    }
    const detail = entry as Record<string, unknown>;
    const feeType =
      typeof detail.FeeType === "string" ? detail.FeeType : undefined;
    const feeAmount = providerMoney(detail.FeeAmount);
    const finalFee = providerMoney(detail.FinalFee);
    if (!feeType || !feeAmount || !finalFee) {
      complete = false;
      continue;
    }
    const promotion = providerMoney(detail.FeePromotion);
    const tax = providerMoney(detail.TaxAmount);
    if (
      feeAmount.currency !== finalFee.currency ||
      (detail.FeePromotion !== undefined && !promotion) ||
      (detail.TaxAmount !== undefined && !tax)
    )
      complete = false;
    components.push({
      feeType,
      feeAmount: feeAmount.amount,
      finalFee: finalFee.amount,
      currency: finalFee.currency,
      ...(promotion ? { promotion: promotion.amount } : {}),
      ...(tax ? { tax: tax.amount } : {}),
      ...(parentFeeType ? { parentFeeType } : {}),
    });
    if (detail.IncludedFeeDetailList !== undefined) {
      const nested: ReturnType<typeof normalizeFeeComponents> =
        normalizeFeeComponents(detail.IncludedFeeDetailList, feeType);
      components.push(...nested.components);
      complete &&= nested.complete;
    }
  }
  return { components, complete };
}
