# ADR-0008: deterministic matching and PackGuard

Status: accepted

## Context

Supplier catalog identifiers and packaging are incomplete or contradictory. A
high-confidence identifier alone is insufficient to safely price a wholesale
case as an Amazon sellable unit.

## Decision

Phase 2 uses a deterministic cascade behind `CatalogProvider`: supplied ASIN,
exact UPC/EAN/GTIN, MPN plus brand, then title candidate search. The engine saves
per-feature evidence and uses fixed scoring thresholds. AI is not in the scoring
or financial calculation path.

Brand, model, size, pack, and variation contradictions prevent automatic
acceptance. PackGuard independently checks case-to-sellable divisibility and
persists a blocking status. Monetary PackGuard output uses Decimal strings and
PostgreSQL NUMERIC.

Provider responses are cached per scan lookup key with provider provenance and
freshness. The initial provider is a deterministic mock fixture only.

## Consequences

Matching is explainable, replay-safe, and does not depend on live Amazon access.
Users must review contradictory candidates, and later profitability work must
honor PackGuard blocks.
