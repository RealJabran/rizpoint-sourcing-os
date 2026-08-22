import { ProviderError } from "@rizpoint/provider-contracts";

export function assertLiveValidationOptIn(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (
    environment.CI ||
    environment.RIZPOINT_ENABLE_LIVE_SP_API_VALIDATION !== "true"
  )
    throw new ProviderError("PERMANENT");
}

export function parseLiveValidationArguments(arguments_: readonly string[]) {
  const asins: string[] = [];
  let price: string | undefined;
  let currency: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index];
    const next = arguments_[index + 1];
    if (value === "--") continue;
    if (value === "--asin" && next) {
      asins.push(next.toUpperCase());
      index += 1;
    } else if (value === "--price" && next) {
      price = next;
      index += 1;
    } else if (value === "--currency" && next) {
      currency = next.toUpperCase();
      index += 1;
    } else throw new ProviderError("INVALID_REQUEST");
  }
  const uniqueAsins = [...new Set(asins)];
  if (
    !uniqueAsins.length ||
    uniqueAsins.length > 5 ||
    uniqueAsins.some((asin) => !/^B[A-Z0-9]{9}$/.test(asin)) ||
    !price ||
    !/^\d+(\.\d{1,4})?$/.test(price) ||
    (currency && !/^[A-Z]{3}$/.test(currency))
  )
    throw new ProviderError("INVALID_REQUEST");
  return { asins: uniqueAsins, price, ...(currency ? { currency } : {}) };
}
