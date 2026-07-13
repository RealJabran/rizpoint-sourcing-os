# ADR-0010: Auditable Decimal profit calculations

## Status

Accepted

## Decision

Profitability is calculated only by `@rizpoint/profit-engine` using Decimal arithmetic and a versioned deterministic fee model. A fee observation records the price it was quoted for; a calculation requires a fee model that reconciles to that quote. Break-even is solved with the fee function and rounded upward to cents.

Financial policies, dated routes, brand policies, calculation runs, and route-specific results are organization-owned PostgreSQL records. Results retain input/evidence snapshots, reasons, and failed rules. Queueing uses the transactional outbox and a policy-version idempotency key.

## Consequences

- Opaque total-fee responses are retained for evidence but cannot produce a calculated scenario.
- Missing route, currency, freshness, history, or PackGuard evidence produces explicit partial results.
- Policy changes create a new idempotency key and a safe recalculation without overwriting prior runs.
- Phase 5 can render stored evidence without rerunning formulas.
