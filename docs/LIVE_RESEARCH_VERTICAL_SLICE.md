# Live research and wholesale vertical slice

Status date: 2026-08-22

This document describes the Prompt 36D working boundary. It does not claim
production readiness, complete Amazon coverage, market size, demand, or a live
provider validation that has not occurred.

## Product research command path

`/product-research` accepts an ASIN, UPC/EAN/GTIN, an Amazon product URL from an
allowlisted marketplace host (only the ASIN is parsed), or a seed phrase for
bounded Amazon Catalog Items keyword search.

Submitting creates a tenant-scoped `ProductResearchRun` and outbox event. Page
navigation never calls Amazon. The worker re-resolves the organization,
marketplace, connection, runtime mode, and entitlements before doing work. A
queued live run fails closed if it resolves to mock or another marketplace.

```text
explicit action -> durable run/outbox -> worker -> entitlement
  -> organization/marketplace cache -> request lease -> provider if required
  -> normalized persisted evidence -> browser-safe projection
```

Manual lookup attempts Catalog Items, competitive/featured offers, a fee
estimate using a user-entered sale price or valid current featured offer, and
Listings Restrictions for the connected seller. An unavailable optional
capability makes the result partial; it is never converted to zero. Raw provider
observations remain private and are never part of the research-run DTO.

## Catalog discovery universe

Keyword discovery uses `CatalogProvider.searchByKeywords`, limits the persisted
response to 20 products, and exposes server-side windowing. The UI calls this an
**Amazon catalog researched universe**. It is not the entire Amazon database,
market size, keyword volume, or demand. Users may select at most five results at
a time for individual product research through the same job/cache boundary.

## Research Projects

Products are saved using a tenant- and marketplace-scoped project dropdown.
Projects can be created without copying a database ID. The hub shows products,
latest research source/freshness, last research run, evidence, assumptions,
notes, economics, risks, watches, and immutable Decision Memos.

## Wholesale journey

```text
supplier -> CSV/XLS/XLSX -> inspect/map -> normalize -> deterministic match
  -> organization provider resolution -> catalog/offers/fees/restrictions
  -> PackGuard -> Decimal profit -> analysis/filter/view -> shortlist
  -> case-aware PO -> licensed/formula-safe export
```

When an organization has any SP-API connection record, inactive or failed live
authorization cannot fall back to demo. Local mock requires both
`PHASE_ZERO_DEMO_MODE=true` and `PROVIDER_MODE=mock`, and remains labeled mock.

## Optional market history

`/settings/integrations/history` exposes the existing Keepa boundary. Without a
reviewed licensed plan and encrypted tenant credential it shows **Provider
required**. SP-API evidence is never transformed into history.

Configured live history requires `MARKET_HISTORY_PROVIDER_MODE=keepa`, an
encrypted `keepa` / `api_key` `ProviderCredential`, the worker-only encryption
key, a tenant `MARKET_HISTORY` token budget, and a per-ASIN token estimate from
the licensed plan. Refresh is explicit and uses existing cache, lease, budget,
append-only observation, and retention controls.

## Primary-navigation dead-screen audit

| Navigation family                    | State                                   | Honest boundary                                                |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------------- |
| Dashboard                            | Working                                 | Stored workflow/provider summary; no invented totals           |
| Wholesale                            | Working                                 | Complete fixture/private slice; live evidence requires Amazon  |
| Research product                     | Working                                 | Explicit background lookup and catalog search                  |
| Product Explorer / Category / Niches | Partially available                     | Stored/tracked universe; missing paid metrics stay unavailable |
| Keywords                             | Provider required / partially available | Stored evidence/contracts; no fabricated volume or rank        |
| Markets / Brands / Sellers           | Partially available                     | Tracked universe; licensed metrics are capability-gated        |
| Projects                             | Working                                 | Product/evidence/economics/risk/note/decision hub              |
| Monitoring                           | Partially available                     | Stored watches/alerts; collection depends on providers         |
| Launch                               | Partially available                     | Deterministic workflows; no Seller Central writes              |
| Amazon integration                   | Working                                 | Organization connection, marketplaces, capability health       |
| Market history                       | Provider required                       | Licensed Keepa boundary; no SP-API history                     |
| Data & providers                     | Working                                 | Persisted cache/call/throttle observability                    |

The release remains a private engineering candidate. Live SP-API validation,
licensed-history validation, real supplier files, and user acceptance remain
operational gates.

## Verification coverage

- URL normalization rejects lookalike Amazon hosts.
- Product jobs persist source, marketplace, time, freshness, and completeness.
- Runtime mismatch proves mock cannot masquerade as queued live evidence.
- Manual lookup covers catalog, offers, fee scenario, and restrictions.
- Catalog discovery proves the bounded-universe statement and avoids implicit
  per-result enrichment.
- Database coverage proves tenant isolation, idempotency, sanitized DTOs, and
  outbox linkage.
- Browser coverage exercises manual research, project save, catalog discovery,
  responsive layout, and provider-required history.

The local end-to-end fixture measurement researched `B000000001` twice through
the real web/outbox/worker path. Run 1 made four provider-adapter calls (catalog,
pricing, fees, restrictions). Run 2 reported `FRESH_HIT` and
`providerCalled=false` for all four operations. The two measurement runs were
removed after verification; their shared cache entries remain governed by the
normal retention policy.
