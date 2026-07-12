# RizPoint Sourcing OS

An explainable Amazon wholesale sourcing platform. It is intentionally built around evidence, pack correctness, tenant boundaries, and deterministic Decimal-based financial calculations.

## Phase 0 status

This repository contains the foundation only: local service topology, typed boundaries, a minimal persisted job lifecycle, and mock processing. It does not ingest supplier files, call Amazon, calculate profits, or provide production authentication yet.

## Local development

Prerequisites: Node.js 22, pnpm 11, Docker Compose, and Python 3.13+ for scanner-only development.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up --build --wait
```

Open `http://localhost:3000/mock-scans`. The page starts a synthetic scan and shows its persisted status.

`PHASE_ZERO_DEMO_MODE=true` is set only by local Compose to enable this mock route. Do not expose it as a production authorization mechanism.

Useful commands:

```bash
pnpm verify
pnpm db:generate
pnpm db:migrate
docker compose logs -f worker scanner web
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
