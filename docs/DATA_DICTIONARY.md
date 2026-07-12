# Data dictionary

## Phase 0 physical schema

| Entity           | Purpose                                                                                                                         | Tenant boundary   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `Organization`   | Logical owner of all business data.                                                                                             | Root tenant       |
| `ScanJob`        | Canonical job state and mock result.                                                                                            | `organization_id` |
| `ScanCheckpoint` | Idempotent stage checkpoint for a job.                                                                                          | Through `ScanJob` |
| `ScanEvent`      | Append-only state/audit event.                                                                                                  | Through `ScanJob` |
| `OutboxEvent`    | Durable instruction to enqueue work after commit; carries a claim token, claim lease, delivery count, and safe last-error code. | `organization_id` |

`ScanJob.mock_result` is Phase 0 synthetic data only. It is not a supplier-row or financial-result table.

## Required future external metric fields

Every catalog, price, fee, restriction, or history observation must carry `provider`, `observed_at`, `freshness_state`, and the relevant provider reference. Cached or stale values may be displayed only with their freshness state.

## Money and ratios

Financial columns use PostgreSQL `NUMERIC`. Application calculations use Decimal libraries and explicit rounding policies. Binary floats are prohibited. Ratios are represented as Decimal values, not percentages stored as floats.

## Future conceptual entities

The blueprint's Organization, supplier, upload, mapping, normalized offer, listing candidate, snapshot, cost scenario, profit result, shortlist, purchase order, and audit entities remain planned; they are not prematurely represented as a broad table in Phase 0.
