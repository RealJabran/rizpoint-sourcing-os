# Architecture

## Components

- **Web (`apps/web`)**: Next.js UI and user-facing API routes.
- **Worker (`apps/worker`)**: BullMQ queue dispatcher and processor owner.
- **Scanner (`services/scanner`)**: FastAPI/Polars service for deterministic file/data processing.
- **PostgreSQL**: canonical business state and checkpoint history.
- **Redis**: BullMQ transport only; it is not canonical job state.
- **MinIO**: local private S3-compatible object storage.

## Upload and mapping job flow

```mermaid
sequenceDiagram
  participant W as Web
  participant P as PostgreSQL
  participant Q as Redis/BullMQ
  participant K as Worker
  participant S as Scanner
  W->>P: transaction: Upload + ScanJob + OutboxEvent
  W->>S: signed URL upload to private object storage
  K->>P: claim OutboxEvent
  K->>Q: enqueue deterministic job id
  K->>S: malware-gated inspection / normalization
  S-->>K: bounded workbook result
  K->>P: checkpoint, rows/warnings, state event
```

The transactional outbox prevents a request from creating a database job without a recoverable enqueue instruction. Claims carry a token and lease; stale claims are reclaimed. Delivery is at least once, so queue IDs include scan and stage (`UPLOAD_INSPECT`, `NORMALIZE`, `MATCH`, or `ENRICH`), while checkpoints and terminal writes are idempotent. Enrichment stores every metric independently with provider, observed time, expiry/freshness, and explicit missing-data flags; outages end as `PARTIAL_SUCCESS`, never silently complete data.

The initial and upload migrations are additive and include reviewed manual `rollback.sql` files for disposable/local recovery. Production rollback requires a backup and change-review decision because it deletes job history and uploaded-row state.

## State model

The upload slice uses `UPLOADED → MAPPING_REQUIRED → READY → NORMALIZING → COMPLETED → MATCHING → COMPLETED`; a terminal inspection or normalization error sets the upload to `REJECTED` and the scan to `FAILED_FINAL`. Retryable failures retain their in-progress upload state and are retried safely. A duplicate request is represented by one outbox event per stage and an idempotent persistence stage. Exactly one upload sheet may be selected for normalization.

## Matching flow

The matching worker calls the typed catalog interface, validates provider payloads, persists provider lookup snapshots before reuse, scores candidate evidence deterministically, runs PackGuard, and writes a decision/checkpoint. Retryable matching jobs resume from persisted row decisions and lookup snapshots. The mock provider is the only Phase 2 adapter. Provider lookup keys are scan-scoped, preventing cross-tenant reuse of supplier-derived title queries.

## Provider boundary

Provider contracts are implemented in `packages/provider-contracts`. Any observed external metric requires provider, observation time, and freshness. Mock/recorded adapters are the default; the optional Amazon SP-API adapter is isolated in `packages/amazon-sp-api`, server-side only, and configuration-gated. The scanner HTTP boundary is validated at runtime by a TypeScript client owned by the worker.

The worker exposes `/health` for liveness and `/ready` only when PostgreSQL, Redis, and the scanner are reachable.

## Runtime baselines

The local containers use Node 22 and Python 3.13+. Next.js requires Node 20.9 or newer; Prisma supports active/maintenance Node LTS releases. See the official [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) and [Prisma system requirements](https://docs.prisma.io/docs/orm/reference/system-requirements).

Compose pins PostgreSQL, Redis, and MinIO release tags so local rebuilds do not silently float across versions.
