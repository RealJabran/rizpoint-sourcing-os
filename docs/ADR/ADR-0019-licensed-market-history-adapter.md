# ADR-0019: Vendor-neutral licensed market history with Keepa first

## Context

SP-API does not provide the historical price, rank, and offer evidence needed
for research. Licensed providers have different fields, token models, and terms.

## Decision

Keep a vendor-neutral `MarketHistoryProvider` contract. Add an optional
`getProductHistory` batch operation (maximum 100 ASINs) while retaining the
legacy price-only method for resumable wholesale checkpoints. Keepa is the first
adapter, but defaults to no live access; recorded fixtures use explicit `MOCK`
origin. A history refresh is an independent scan-owned checkpoint and only
accepts already accepted ASINs. It persists useful normalized points into the
existing append-only research series, with source observation, provider,
marketplace, observed time, freshness, and completeness. It does not alter
matching or deterministic profit calculations.

Raw Keepa response evidence is redacted, private, and retention-bounded. The
API key is an encrypted tenant `ProviderCredential` accessed only by the worker.
The shared provider cache, lease, entitlement, telemetry, and rate-budget
mechanisms remain the only control-plane path.

## Consequences

Historical metrics are visible only when actually returned. Sparse histories,
throttling, authorization failures, and absent products are explicit. A licensed
subscription, correct terms, and encrypted credential onboarding remain external
operator responsibilities. No historical sales estimate is inferred or labeled
as Amazon-reported data.
