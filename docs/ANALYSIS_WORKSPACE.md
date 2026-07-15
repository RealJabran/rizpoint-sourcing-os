# Analysis workspace

Phase 5 presents one current `ProfitResult` per supplier-row and shipping-route. Historical calculation results are retained for audit, but grid queries require `is_current = true`, use bounded windows of at most 100 rows, and select only grid fields; evidence JSON is fetched only when a drawer is opened. A targeted calculation reads only its persisted target rows rather than the full scan.

## Editing and recalculation

Inline edits create typed `ProfitCostOverride` records rather than changing source rows, PackGuard findings, provider observations, or historical result snapshots. Money is stored as `NUMERIC(18,4)` and sent over APIs as decimal strings. A visible reason, revision, and idempotency key are mandatory. Only fields the user changed are sent; omitted cost/stress fields retain their prior values, while an explicit null clears a field. Edits create a targeted calculation run containing exactly the row/route pair. A target result is promoted only when its override revision and run ID still match the active override, preventing an older worker from replacing a newer decision.

The drawer shows current and alternative-route results, supplier source values,
normalized data, selected and rejected match candidates with feature evidence,
PackGuard, warnings, provider observations with timestamps/freshness expiry,
inputs, full formula/decision evidence, override history, workflow audit events,
and mapped next actions. Replay is read-only, requires the stored profit-engine
version, reconstructs current/conservative/stress scenarios and the
recommendation, and compares every persisted financial output and reason code.

## Accessibility and scale

The default grid virtualizes fixed-height rows and server-windows data. It keeps identity columns pinned, labels current versus conservative financial values and currency, exposes partial/pending calculation state, announces loading and queued recalculation, and provides a native paginated table mode for assistive technology. The evidence drawer moves focus on open, traps tab navigation, supports Escape, and restores focus when closed. The generated 50,000-row fixture verifies that a distant viewport resolves to one 100-row window rather than a full payload; production release also requires a database-and-browser load measurement at 5k, 20k, and 50k rows.
