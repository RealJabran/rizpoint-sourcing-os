# ADR-0011: Current result projection and targeted recalculation

## Status

Accepted

## Context

Profit calculations are historical, route-specific records. A virtual workspace needs a fast, non-duplicated current view and inline assumptions must not rewrite supplier/provider source evidence.

## Decision

`ProfitResult.is_current` is the current projection, enforced by a partial unique index per organization/scan/supplier-row/route. Historical results remain immutable. Typed override values use `NUMERIC`; each update has an append-only audit event, revision, reason, and idempotency key. A cost or stress edit creates a targeted calculation run and target row/route record. The outbox and worker payload carry the run ID.

## Consequences

Grid reads are bounded, explicitly lightweight, and tenant-scoped. Targeted workers load only their target rows. Concurrent edits cannot promote another run because persistence checks the active override revision and calculation-run ID before replacing the current projection. Rollback is destructive for Phase 5 view/override metadata and therefore requires a backup in production.
