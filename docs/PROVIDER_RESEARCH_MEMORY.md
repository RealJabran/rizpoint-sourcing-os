# Provider research memory

RizPoint uses PostgreSQL as durable research memory. It does not use an
in-process product cache and it does not create a second cache store.
`ProviderCacheEntry`, `ProviderRequestLease`, `ProviderRequestAttempt`, typed
observations, `CatalogProduct`, entitlements, and rate budgets remain the
canonical runtime primitives.

## Read-through workflow

Explicit research and refresh jobs call the worker-only
`accessProviderData` service. The service:

1. canonicalizes request object keys without lowercasing or rewriting phrases;
2. hashes the canonical request with SHA-256;
3. reads the organization/provider/marketplace/capability/operation/hash cache
   row;
4. returns a fresh normalized projection without a provider call;
5. may return a visibly stale projection only when the caller opts into
   stale-while-refresh and supplies a durable refresh scheduler;
6. checks entitlement state before any live call;
7. collapses an identical concurrent request with `ProviderRequestLease`;
8. reserves a configured NUMERIC rate budget when the adapter declares one;
9. calls and normalizes the provider, persists append-only evidence through the
   workflow callback, then updates `ProviderCacheEntry`; and
10. appends sanitized request telemetry containing hashes and counts, never
    request payloads or credentials.

A forced refresh skips the fresh/stale reuse decisions. It does not skip the
entitlement, lease, adapter throttle, or paid-provider rate budget. If a live
request is throttled or fails, the existing cache and observations remain
unchanged.

Web pages never import the worker data-access service. Page navigation reads
persisted projections and observations. The **Refresh data**, **Refresh Amazon
data**, and **Refresh history** actions create checkpointed outbox work.

## Default freshness policy

These are RizPoint product defaults, not promises about a provider's service or
the future accuracy of a value. Every returned metric still shows its source,
marketplace, `observed_at`, freshness, and completeness.

| Data class                     |      Fresh | Stale-while-refresh |          Retain | Rationale                                                                                                                                      |
| ------------------------------ | ---------: | ------------------: | --------------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog identity               |   24 hours |             6 hours |         30 days | Identity and core attributes normally change less often than offers, while a daily bound still catches listing edits.                          |
| Competitive offers/pricing     | 15 minutes |          45 minutes |         30 days | Offers are volatile; the short fresh window limits misleading price reuse.                                                                     |
| Fee estimate scenario          |    6 hours |            18 hours |         30 days | The cache key includes price, currency, fulfillment, and scenario, so a different scenario never reuses the quote.                             |
| Listing restrictions           |   24 hours |            24 hours |         30 days | Eligibility is account-specific and important, but polling it on every view is wasteful. Users can force verification before a decision.       |
| Licensed market history        |    6 hours |            18 hours | 30 days maximum | Historical series usually append on a slower cadence. Contractual provider retention can shorten this window and fails closed if incompatible. |
| Keyword discovery/reverse ASIN |     7 days |              7 days |         90 days | Paid keyword snapshots generally do not justify page-load refreshes; the observation date remains visible.                                     |
| Search rank                    |   24 hours |            24 hours |         90 days | Matches the default daily tracking cadence; higher-frequency adapters may override explicitly.                                                 |

Other optional provider capabilities retain their versioned defaults in
`packages/provider-contracts/src/runtime-policy.ts`.

## Configuration

An operator may override a capability after documenting the provider contract
and business need:

```text
RIZPOINT_CACHE_<CAPABILITY>_FRESH_SECONDS
RIZPOINT_CACHE_<CAPABILITY>_STALE_SECONDS
RIZPOINT_CACHE_<CAPABILITY>_RETAIN_SECONDS
```

For example, `RIZPOINT_CACHE_COMPETITIVE_OFFERS_FRESH_SECONDS=600` sets a
10-minute pricing window. Values must be whole seconds. Retention must cover
the full fresh plus stale-serving window. Licensed retention rights always cap
the product default.

## Product memory and history

Catalog matching persists the normalized product identity, identifiers,
attributes, dimensions/images where supplied, and returned sales-rank/category
projection in `CatalogProduct` and `ProductIdentifier`. Enrichment persists
competitive offers, exact-price fee scenarios, and restrictions as typed
`ProviderObservation` records. Licensed history persists an append-only
`ResearchObservation` envelope plus metric series/points. Valid sales estimates
remain separate versioned evidence and are never invented when no provider or
calibrated model exists. Project items, watches, and market membership continue
to reference the same `CatalogProduct`; cache refresh never rewrites those
associations.

Cache replacement does not delete prior typed observations. Provider evidence
retention continues to follow provider data-rights policy.

## Observability

**Settings → Data & Providers** displays tenant-scoped 30-day totals for live
calls, fresh hits, misses, stale hits, refreshes, throttles, and configured
credit/token/cost estimates. Mock attempts remain identifiable by runtime mode
and never count as live calls. The endpoint exposes no connection IDs, request
inputs, cache payloads, raw provider responses, or credentials.

## Validation

`tests/integration/provider-memory.integration.ts` proves:

- first call stores evidence and cache;
- a fresh second call avoids the provider;
- reuse survives a database-client disconnect/reconnect (no process cache);
- expiry calls again and retains earlier observations;
- organization and marketplace isolation;
- forced refresh, partial response, throttle preservation; and
- concurrent identical miss coalescing through the database lease.
