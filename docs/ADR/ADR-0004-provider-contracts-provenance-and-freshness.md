# ADR 0004: Provider contracts, provenance, and freshness

## Decision

Provider capabilities are typed interfaces with runtime schemas. Catalog, pricing, fees, restrictions, and history observations carry provider, observed time, and freshness state. Monetary payload fields are decimal strings.

## Consequences

Mock adapters are used in Phase 0. Amazon and historical providers can later be added without leaking provider semantics into the domain layer.
