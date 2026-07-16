import {
  persistEnrichmentItem,
  recordProviderCallAttempt,
  type Prisma,
} from "@rizpoint/database";
import {
  ProviderError,
  type FeeEstimate,
  type FeeScenarioSource,
} from "@rizpoint/provider-contracts";
import { Decimal } from "decimal.js";
import { createHash } from "node:crypto";
import {
  createEnrichmentProvider,
  type EnrichmentConnection,
} from "./enrichment-provider.js";
import type { FeeQuote } from "@rizpoint/profit-engine";

const FEE_FRESH_FOR_MS = 15 * 60_000;
const inFlightFeeRequests = new Map<string, Promise<FeeQuote | null>>();

export type StoredFeeObservation = {
  metricType: string;
  provider: string;
  observedAt: Date;
  freshUntil: Date;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  currency: string | null;
  primaryAmount: { toString(): string } | null;
  quotedPrice: { toString(): string } | null;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN" | null;
  observationStatus: string;
  feeScenarioSource:
    "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED" | null;
  feeFulfillment: "AMAZON" | "MERCHANT" | "UNKNOWN" | null;
  feeComponents: Array<{
    feeType: string;
    parentFeeType: string | null;
    currency: string;
    finalFee: { toString(): string };
  }>;
  payload: unknown;
};

type FeeScenarioItem = {
  id: string;
  asin: string;
  enrichmentRun: {
    id: string;
    attemptCount: number;
    providerConnection: EnrichmentConnection | null;
  };
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function feeQuoteFromObservation(
  observation: StoredFeeObservation | null,
): FeeQuote | null {
  if (
    !observation ||
    observation.metricType !== "FEES" ||
    observation.observationStatus !== "SUCCESS" ||
    observation.completeness !== "COMPLETE" ||
    !observation.primaryAmount ||
    !observation.quotedPrice ||
    !observation.currency ||
    !observation.feeScenarioSource ||
    !observation.feeFulfillment ||
    observation.feeFulfillment === "UNKNOWN" ||
    observation.feeComponents.length === 0
  )
    return null;
  const value = (
    observation.payload as {
      value?: {
        totalFee?: string;
        quotedPrice?: string;
        currency?: string;
        model?: {
          fixedFee?: string;
          percentageOfPrice?: string;
          minimumFee?: string;
        };
      };
    }
  ).value;
  if (!value?.totalFee || !value.quotedPrice || !value.currency) return null;
  if (
    !new Decimal(observation.primaryAmount.toString()).eq(value.totalFee) ||
    !new Decimal(observation.quotedPrice.toString()).eq(value.quotedPrice)
  )
    return null;
  return {
    totalFee: value.totalFee,
    quotedPrice: value.quotedPrice,
    currency: value.currency,
    provider: observation.provider,
    observedAt: observation.observedAt.toISOString(),
    freshUntil: observation.freshUntil.toISOString(),
    freshnessState: observation.freshnessState,
    completeness: observation.completeness,
    scenarioSource: observation.feeScenarioSource,
    fulfillmentChannel: observation.feeFulfillment,
    components: observation.feeComponents.map((component) => ({
      feeType: component.feeType,
      finalFee: component.finalFee.toString(),
      currency: component.currency,
      ...(component.parentFeeType
        ? { parentFeeType: component.parentFeeType }
        : {}),
    })),
    ...(value.model?.fixedFee && value.model.percentageOfPrice
      ? {
          model: {
            fixedFee: value.model.fixedFee,
            percentageOfPrice: value.model.percentageOfPrice,
            ...(value.model.minimumFee
              ? { minimumFee: value.model.minimumFee }
              : {}),
          },
        }
      : {}),
  };
}

export function findExactFeeQuote(
  observations: readonly StoredFeeObservation[],
  scenarioSource: FeeScenarioSource,
  price: string,
  currency: string,
  fulfillmentChannel: "AMAZON" | "MERCHANT",
  calculatedAt: Date,
): FeeQuote | null {
  const candidates = observations
    .filter(
      (observation) =>
        observation.metricType === "FEES" &&
        observation.feeScenarioSource === scenarioSource &&
        observation.quotedPrice &&
        observation.currency === currency &&
        observation.feeFulfillment === fulfillmentChannel &&
        new Decimal(observation.quotedPrice.toString()).eq(price),
    )
    .sort(
      (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
    );
  for (const candidate of candidates) {
    const quote = feeQuoteFromObservation(candidate);
    if (
      quote &&
      quote.freshnessState === "FRESH" &&
      new Date(quote.freshUntil).getTime() >= calculatedAt.getTime()
    )
      return quote;
  }
  return null;
}

function providerFailure(error: unknown) {
  if (!(error instanceof ProviderError))
    return {
      code: "UNKNOWN",
      status: "RETRYABLE_ERROR" as const,
      observationStatus: "RETRYABLE_FAILURE" as const,
    };
  const throttled = error.code === "THROTTLED";
  const retryable = ["TRANSIENT", "PROVIDER_OUTAGE"].includes(error.code);
  return {
    code: error.code,
    status: throttled
      ? ("THROTTLED" as const)
      : retryable
        ? ("RETRYABLE_ERROR" as const)
        : ("PERMANENT_ERROR" as const),
    observationStatus:
      error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN"
        ? ("UNAUTHORIZED" as const)
        : throttled
          ? ("THROTTLED" as const)
          : retryable
            ? ("RETRYABLE_FAILURE" as const)
            : error.code === "NOT_FOUND"
              ? ("UNAVAILABLE" as const)
              : ("TERMINAL_FAILURE" as const),
    retryAt: error.options.retryAfterMs
      ? new Date(Date.now() + error.options.retryAfterMs)
      : undefined,
    httpStatus: error.options.httpStatus,
    providerRequestId: error.options.providerRequestId,
  };
}

function normalizedObservation(
  estimate: FeeEstimate,
  provider: "AMAZON_SP_API" | "MOCK_AMAZON",
  requestInputs: Record<string, unknown>,
  requestHash: string,
) {
  const observedAt = new Date(estimate.provenance.observedAt);
  if (Number.isNaN(observedAt.getTime()))
    throw new ProviderError("INVALID_RESPONSE");
  const value = estimate.value;
  return {
    metricType: "FEES" as const,
    provider,
    observationKey: `FEE:${value.scenarioSource}:${requestHash}`,
    observedAt,
    freshUntil: new Date(observedAt.getTime() + FEE_FRESH_FOR_MS),
    freshnessState: estimate.provenance.freshnessState,
    marketplaceId: value.marketplaceId,
    ...(estimate.provenance.providerReference
      ? { providerReference: estimate.provenance.providerReference }
      : {}),
    payload: json(estimate),
    primaryAmount: value.totalFee,
    quotedPrice: value.quotedPrice,
    currency: value.currency,
    operation: value.operation,
    observationStatus:
      value.completeness === "COMPLETE"
        ? ("SUCCESS" as const)
        : ("PARTIAL" as const),
    requestHash,
    requestInputs: json(requestInputs),
    completeness: value.completeness,
    ...(estimate.rawProviderObservation !== undefined
      ? {
          rawEvidence: json(estimate.rawProviderObservation),
          rawEvidenceReference: stableHash(estimate.rawProviderObservation),
        }
      : {}),
    asin: value.asin,
    feeScenarioSource: value.scenarioSource,
    feeFulfillment: value.fulfillmentChannel,
    feeComponents: value.components.map((component) => ({
      feeType: component.feeType,
      currency: component.currency,
      feeAmount: component.feeAmount,
      finalFee: component.finalFee,
      ...(component.parentFeeType
        ? { parentFeeType: component.parentFeeType }
        : {}),
      ...(component.promotion ? { promotionAmount: component.promotion } : {}),
      ...(component.tax ? { taxAmount: component.tax } : {}),
    })),
  };
}

export async function ensureExactFeeQuote(input: {
  organizationId: string;
  calculationAttempt: number;
  item: FeeScenarioItem;
  observations: readonly StoredFeeObservation[];
  scenarioSource: FeeScenarioSource;
  price: string;
  currency: string;
  fulfillmentChannel: "AMAZON" | "MERCHANT";
  calculatedAt: Date;
}): Promise<FeeQuote | null> {
  const existing = findExactFeeQuote(
    input.observations,
    input.scenarioSource,
    input.price,
    input.currency,
    input.fulfillmentChannel,
    input.calculatedAt,
  );
  if (existing) return existing;
  const bundle = createEnrichmentProvider(
    input.item.enrichmentRun.providerConnection,
  );
  const requestInputs = {
    operation: "getMyFeesEstimateForASIN",
    asin: input.item.asin,
    marketplaceId: bundle.marketplace.marketplaceId,
    price: input.price,
    listingPrice: input.price,
    shippingPrice: "0",
    currency: input.currency,
    fulfillmentChannel: input.fulfillmentChannel,
    scenarioSource: input.scenarioSource,
  };
  const requestHash = stableHash(requestInputs);
  const flightKey = `${input.organizationId}:${input.item.id}:${requestHash}`;
  const active = inFlightFeeRequests.get(flightKey);
  if (active) return active;
  const task = (async () => {
    try {
      const estimate = await bundle.provider.estimateFees({
        asin: input.item.asin,
        marketplace: bundle.marketplace,
        fulfillmentChannel: input.fulfillmentChannel,
        price: input.price,
        listingPrice: input.price,
        shippingPrice: "0",
        currency: input.currency,
        scenarioSource: input.scenarioSource,
        requestId: `${input.item.enrichmentRun.id}:${requestHash.slice(0, 24)}`,
      });
      if (
        estimate.value.asin !== input.item.asin ||
        estimate.value.marketplaceId !== bundle.marketplace.marketplaceId ||
        estimate.value.scenarioSource !== input.scenarioSource ||
        estimate.value.currency !== input.currency ||
        estimate.value.fulfillmentChannel !== input.fulfillmentChannel ||
        !new Decimal(estimate.value.quotedPrice).eq(input.price)
      )
        throw new ProviderError("INVALID_RESPONSE");
      const observation = normalizedObservation(
        estimate,
        bundle.providerKind,
        requestInputs,
        requestHash,
      );
      await persistEnrichmentItem({
        enrichmentItemId: input.item.id,
        observations: [observation],
        missingMetrics: [],
        preserveItemStatus: true,
      });
      await recordProviderCallAttempt({
        organizationId: input.organizationId,
        enrichmentRunId: input.item.enrichmentRun.id,
        provider: bundle.providerKind,
        operation: "getMyFeesEstimateForASIN",
        requestKey: requestHash,
        attempt: input.calculationAttempt,
        status: "SUCCESS",
      });
      return feeQuoteFromObservation({
        ...observation,
        primaryAmount: { toString: () => observation.primaryAmount },
        quotedPrice: { toString: () => observation.quotedPrice },
        currency: observation.currency,
        feeComponents: observation.feeComponents.map((component) => ({
          feeType: component.feeType,
          parentFeeType: component.parentFeeType ?? null,
          currency: component.currency,
          finalFee: { toString: () => component.finalFee },
        })),
      });
    } catch (error) {
      const failure = providerFailure(error);
      await recordProviderCallAttempt({
        organizationId: input.organizationId,
        enrichmentRunId: input.item.enrichmentRun.id,
        provider: bundle.providerKind,
        operation: "getMyFeesEstimateForASIN",
        requestKey: requestHash,
        attempt: input.calculationAttempt,
        status: failure.status,
        errorCode: failure.code,
        ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
        ...(failure.providerRequestId
          ? { providerRequestId: failure.providerRequestId }
          : {}),
        ...(failure.retryAt ? { retryAt: failure.retryAt } : {}),
      });
      await persistEnrichmentItem({
        enrichmentItemId: input.item.id,
        observations: [
          {
            metricType: "FEES",
            provider: bundle.providerKind,
            observationKey: `FEE:${input.scenarioSource}:${requestHash}`,
            observedAt: new Date(),
            freshUntil: new Date(),
            freshnessState: "UNKNOWN",
            marketplaceId: bundle.marketplace.marketplaceId,
            payload: { errorCode: failure.code },
            operation: "getMyFeesEstimateForASIN",
            observationStatus: failure.observationStatus,
            requestHash,
            requestInputs: json(requestInputs),
            completeness: "UNKNOWN",
            asin: input.item.asin,
            feeScenarioSource: input.scenarioSource,
            feeFulfillment: input.fulfillmentChannel,
          },
        ],
        missingMetrics: [],
        preserveItemStatus: true,
      });
      if (
        failure.status === "THROTTLED" ||
        failure.status === "RETRYABLE_ERROR"
      )
        throw error;
      return null;
    }
  })();
  inFlightFeeRequests.set(flightKey, task);
  try {
    return await task;
  } finally {
    if (inFlightFeeRequests.get(flightKey) === task)
      inFlightFeeRequests.delete(flightKey);
  }
}
