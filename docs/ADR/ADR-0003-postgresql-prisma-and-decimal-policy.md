# ADR 0003: PostgreSQL, Prisma, and Decimal policy

## Decision

Use PostgreSQL with Prisma migrations as the schema source of truth. Use `NUMERIC` and Decimal values for money and ratios.

## Consequences

No binary float financial columns or calculations are allowed. Prisma 7 is configured with ESM and the PostgreSQL driver adapter.
