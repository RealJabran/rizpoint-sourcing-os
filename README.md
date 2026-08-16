# RizPoint Sourcing OS

An explainable Amazon wholesale sourcing platform. It is intentionally built around evidence, pack correctness, tenant boundaries, and deterministic Decimal-based financial calculations.

## Current status

This repository includes Phases 0–7 foundations: upload/mapping, deterministic matching and PackGuard, fixture-first enrichment, Decimal profit/decision calculations, analysis, shortlists, purchase orders, safe exports, and private-production safeguards. Real Amazon enrichment remains configuration-gated and must be approved separately from local fixture mode.

## Local development

Prerequisites: Node.js 22, pnpm 11, Docker Compose, and Python 3.13+ for scanner-only development.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up --build --wait
```

Open `http://localhost:3000/uploads`. The seeded `VSI` supplier lets you exercise a local upload/mapping flow without committing supplier data. MinIO accepts browser uploads only through short-lived signed URLs from the local web origin.

See [local catalog import testing](docs/LOCAL_TESTING.md) for the API and browser verification flow.

After a mapping is confirmed, **Start scan** advances the checkpointed local workflow through normalization, matching, fixture enrichment, restrictions, and deterministic calculation. The completed or partial result opens at `/scans/{scanId}/analysis`. Local mode uses deterministic mock fixtures; the server-only SP-API adapter is configuration-gated and has no real credentials in this repository.

Market history also defaults to `MARKET_HISTORY_PROVIDER_MODE=mock`, which uses
recorded fixtures and is visibly labeled as such. The Keepa adapter is available
only after an owner stores an encrypted `keepa` / `api_key` credential; it is not
required for wholesale scans and never changes deterministic profit results.

`PHASE_ZERO_DEMO_MODE=true` is set only by local Compose to enable this mock route. Do not expose it as a production authorization mechanism.

Compose runs the built Next.js image with `next start` and `NODE_ENV=production`; its explicit unauthenticated demo exception is accepted only with both local-demo flags, loopback application URLs, and loopback-bound host ports. Direct `pnpm dev` remains the development-tooling path.

Useful commands:

```bash
pnpm verify
pnpm db:generate
pnpm db:migrate
docker compose logs -f worker scanner clamav web
docker compose down --volumes
```

`docker compose down --volumes` intentionally removes local development data.

## Phase 6 workflow

Create shortlists through `/shortlists`, add eligible analysis results through the shortlist API, and build a single-supplier, single-route purchase order. Validate the draft before queueing CSV, XLSX, or audit exports. Download links are temporary and exports remain private object-store artifacts.

Outside local Compose, set the server-only `RIZPOINT_PRIVATE_ACCESS_TOKEN` and send it as `Authorization: Bearer <token>` (or the `rizpoint_private_access` HttpOnly cookie) for Phase 6 workflow routes. Local Compose intentionally permits the synthetic demo organization only.

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data dictionary](docs/DATA_DICTIONARY.md)
- [Profit engine policy](docs/PROFIT_ENGINE.md)
- [Matching policy](docs/MATCHING.md)
- [Security](docs/SECURITY.md)
- [Architecture decisions](docs/ADR)
- [Private operations](docs/OPERATIONS.md)
- [Recovery runbook](docs/RECOVERY_RUNBOOK.md)
- [Private user guide](docs/USER_GUIDE.md)

## Guardrails

- Do not commit supplier files, provider credentials, or exports.
- Store financial values in PostgreSQL `NUMERIC` and Decimal types only.
- Providers expose typed interfaces and record provenance and freshness.
- A pack/case contradiction blocks automatic acceptance.
