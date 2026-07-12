# RizPoint Sourcing OS

An explainable Amazon wholesale sourcing platform. It is intentionally built around evidence, pack correctness, tenant boundaries, and deterministic Decimal-based financial calculations.

## Phase 1 status

This repository includes the Phase 0 foundation and Phase 1 upload/mapping slice. A local demo user can upload CSV, XLSX, or XLS supplier catalogs, select a sheet/header row, save validated mappings (including a VSI profile), and normalize rows with persisted warnings. It does not call Amazon, calculate profits, or provide production authentication yet.

## Local development

Prerequisites: Node.js 22, pnpm 11, Docker Compose, and Python 3.13+ for scanner-only development.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up --build --wait
```

Open `http://localhost:3000/uploads`. The seeded `VSI` supplier lets you exercise a local upload/mapping flow without committing supplier data. MinIO accepts browser uploads only through short-lived signed URLs from the local web origin.

`PHASE_ZERO_DEMO_MODE=true` is set only by local Compose to enable this mock route. Do not expose it as a production authorization mechanism.

Useful commands:

```bash
pnpm verify
pnpm db:generate
pnpm db:migrate
docker compose logs -f worker scanner clamav web
docker compose down --volumes
```

`docker compose down --volumes` intentionally removes local development data.

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data dictionary](docs/DATA_DICTIONARY.md)
- [Profit engine policy](docs/PROFIT_ENGINE.md)
- [Matching policy](docs/MATCHING.md)
- [Security](docs/SECURITY.md)
- [Architecture decisions](docs/ADR)

## Guardrails

- Do not commit supplier files, provider credentials, or exports.
- Store financial values in PostgreSQL `NUMERIC` and Decimal types only.
- Providers expose typed interfaces and record provenance and freshness.
- A pack/case contradiction blocks automatic acceptance.
