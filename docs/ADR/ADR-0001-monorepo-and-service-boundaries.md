# ADR 0001: Monorepo and service boundaries

## Decision

Use a pnpm/Turborepo monorepo with a Next.js web application, Node worker, FastAPI scanner, shared TypeScript packages, and a PostgreSQL database package.

## Rationale

Web and worker share stable queue/domain contracts, while Polars processing remains independently deployable and horizontally scalable.

## Consequences

Cross-language calls use explicit HTTP/OpenAPI contracts. The scanner does not own canonical database state.
