# RizPoint Sourcing OS engineering rules

## Mission

Build an explainable Amazon wholesale sourcing system. Correct matches and auditable financial calculations matter more than feature count.

## Required behavior

- Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and the relevant domain document before changing behavior.
- Plan before edits when a task spans more than one module.
- Keep provider integrations behind interfaces.
- Use Decimal/NUMERIC for money; never binary floating-point.
- AI may suggest matches or explanations but may not calculate financial outputs.
- Never auto-accept a match with a brand, model, size, or pack contradiction.
- Every external value must retain source, timestamp, and freshness state.
- All jobs and provider calls must be idempotent and retry-safe.
- Never commit secrets, real credentials, or unredacted supplier files.
- Preserve tenant isolation in all database access, even during the private phase.

## Definition of done

- Acceptance criteria are met.
- New behavior has tests.
- Lint, typecheck, unit tests, and relevant integration/e2e tests pass.
- Migrations are reversible and reviewed.
- Documentation is updated.
- Error states and empty states are handled.
- No unrelated refactors.

## Working style

- Use `apply_patch` for deliberate edits.
- Show the proposed file-level plan before large changes.
- Prefer small vertical slices and checkpoint commits.
- Report assumptions, commands run, test results, and remaining risks.
