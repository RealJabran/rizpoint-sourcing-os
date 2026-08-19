# Research performance and scale baseline

## Scope and measured query inventory

Prompt 33 keeps PostgreSQL, Prisma, BullMQ, and the existing private object
store. The audit did not establish a reason to add TimescaleDB, ClickHouse, or
a warehouse. The high-volume paths and their enforced bounds are:

| Path                     | Stored universe                                                    | Bound / protection                                                                    |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Product Explorer         | organization-imported, project, watch, market, or history products | 100-row API cap, 8-second PostgreSQL statement timeout                                |
| Category detail          | same tracked product universe                                      | 100-row page, 1,000-product deterministic aggregate window, 8-second timeout          |
| Reverse ASIN / graph     | licensed product-keyword or market observations                    | 10,000-observation input window; 1,000-keyword or 100-neighbor output                 |
| History provider refresh | accepted scan ASINs                                                | one provider batch of at most 100 ASINs, provider cache + request lease + rate budget |
| History persistence      | normalized metric points                                           | 1,000-point bulk writes, four-product persistence concurrency                         |
| Analysis export          | stored current results                                             | asynchronous job, 5,000-row worker windows                                            |
| History retry scheduler  | retryable refresh runs                                             | 25 due runs per minute, idempotent attempt-keyed outbox events                        |
| Retention                | exports, raw provider evidence, historical points                  | bounded oldest-first batches; report-only unless deletion is explicitly enabled       |

Page loads query stored normalized evidence only. They do not invoke providers.
Provider cache entries distinguish fresh, stale-while-refresh, and expired
windows; request leases coalesce concurrent identical provider work. A stale or
failed refresh never zeroes or deletes the prior normalized observation.

## Index decisions

Migration `20260819090000_research_scale_indexes` adds tenant-leading composite
indexes only for predicates observed in Product Explorer, Category Intelligence,
reverse-ASIN/product relationship queries, history retry scheduling, and latest
history/offer/opportunity lateral reads. The existing btree
`organization_id, series_id, metric_at` and global `metric_at` BRIN indexes are
retained.

No table is partitioned in this stage. Partitioning adds operational and foreign
key complexity and was not justified by the scaled benchmark. Reconsider native
PostgreSQL range partitioning only after production measurements show at least
one of the following despite healthy autovacuum and the documented indexes:

- historical points exceed 50 million and retention batches cannot stay under
  the maintenance budget;
- index or vacuum working sets no longer fit the provisioned Postgres tier;
- p95 bounded history reads exceed the 8-second interactive protection budget;
- deletion creates sustained bloat that bounded batches cannot control.

Likewise, the current tracked-universe queries do not justify a materialized
view. Their membership is mutable and tenant-scoped, while response windows are
small. Add a versioned aggregate table or materialized view only after query
plans show repeated aggregation—not lateral lookup or missing index work—is the
bottleneck.

## Benchmark fixtures and budgets

`pnpm test:research-scale` creates transaction-local PostgreSQL tables, loads a
10% scaled-equivalent fixture, builds the same high-value composite indexes,
runs latest-product and product-keyword window queries, asserts the shared
8-second interactive budget, and drops everything on transaction completion.
It does not retain or modify product data.

Profiles:

| Profile                                | Products | Observations | Product-keyword observations |
| -------------------------------------- | -------: | -----------: | ---------------------------: |
| `scaled` (default)                     |   10,000 |      100,000 |                      500,000 |
| `full` (`RIZPOINT_SCALE_PROFILE=full`) |  100,000 |    1,000,000 |                    5,000,000 |

The full profile is opt-in because fixture construction is intentionally heavy.
Both profiles use constant-size application windows; the unit performance
contract verifies 1,000 bounded windows for each full-scale dimension rather
than allocating a five-million-element application array.

Measured local Docker baseline on 2026-08-19 (PostgreSQL 17.8,
transaction-local tables on the same host):

| Profile                | Fixture + indexes | Latest 100 products | Keyword overlap, 100 products | Query budget |
| ---------------------- | ----------------: | ------------------: | ----------------------------: | -----------: |
| `scaled` 10k/100k/500k |          2,315 ms |                5 ms |                          6 ms |   < 8,000 ms |
| `full` 100k/1M/5M      |         22,827 ms |                4 ms |                          5 ms |   < 8,000 ms |

These figures are development baselines, not production capacity claims. Record
p50/p95 query latency, row counts, cache outcomes, queue age, provider throttle
rates, and retention batch duration in production before changing storage
technology.

## Retention and downsampling

Every history series keeps its explicit `retentionDays`. The worker selects at
most 1,000 expired points using the BRIN time path, rechecks the series policy
inside the delete transaction, scopes deletion by organization, and writes an
audit event. Default `RIZPOINT_RETENTION_MODE=report` deletes nothing.

Automatic downsampling is deliberately disabled: individual normalized points
are evidence and dropping them early could violate replay or provider-rights
requirements. Versioned `HistoryAnalyticsAssessment` records are the compact
derived summaries. If a provider requires shorter retention, set the series
retention policy; do not silently replace evidence with interpolated points.

## Queue service classes

BullMQ uses explicit numeric priority classes (lower is earlier): interactive
ingestion/matching `1`, calculations `3`, exports `6`, and scheduled history
refresh `10`. Worker concurrency remains bounded at four with the existing
global limiter. Provider-specific leases and rate budgets remain authoritative,
so increasing worker concurrency cannot bypass licensed quotas.
