# ADR-0017: Research identity, observations, and normalized history

## Status

Accepted — 2026-08-16

## Context

The wholesale observation model is correctly anchored to an enrichment item and
supplier row. Market research has no supplier row and needs products, keywords,
markets, categories, brands, and sellers to share consistent provenance without
creating a second product truth table. Historical data may be sparse, licensed,
and subject to provider-specific retention limits. Derived opportunity metrics
must never be confused with raw external evidence.

## Decision

- Reuse `CatalogProduct` and `ProductIdentifier` as provider catalog identity.
  Research product items reference that identity instead of copying ASIN truth.
- Add tenant-scoped research projects with explicit `PRIVATE_LABEL`, `WHOLESALE`,
  and `MANUAL_ASIN` modes.
- Use `ResearchObservation` as a marketplace/time/provider provenance envelope
  and one-to-one typed observation projections for queryable domain facts.
- Keep provider keys as strings at this generic boundary so adding a licensed
  provider does not require pretending it is an Amazon provider enum member.
- Keep raw evidence private and reference it by an opaque storage key/checksum;
  typed projections, not raw JSON, are the application read contract.
- Store sparse history as normalized series and typed points. A point references
  the observation that retrieved it and stores exactly one value representation.
- Default series retention to 730 days, allow stricter provider-specific values,
  index series reads with btree and retention scans with BRIN, and defer
  partitioning or a separate time-series database until measured scale requires
  it.
- Store opportunity assessments separately with calculation version, input
  observation references, calculation time, and ordered reasons. Repository
  methods create new assessments; they never update external observations.
- Enforce organization identity through composite foreign keys for tenant-owned
  relationships and require organization predicates in repository reads.

## Consequences

Wholesale tables and routes remain unchanged. Research providers and jobs can be
added without dummy scans or supplier rows, but Prompt 02 intentionally provides
no live research data. Category, brand, and seller subjects use an explicit
marketplace-scoped subject key until a licensed provider supplies canonical
resolution; that key is not a claim of global identity or brand ownership.

Rollback drops only the additive research tables and enums. It is destructive to
research data and therefore requires backup review outside disposable local
environments.
