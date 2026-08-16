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

## Next-level prompt pack protocol

- The canonical staged expansion instructions are in `docs/NEXT_LEVEL_PROMPT_PACK.md` (version 2026-08-16). Read its global operating contract and the complete requested prompt before acting.
- A request such as `run prompt 00` means execute only that exact numbered prompt. Do not begin, partially implement, or prepare runtime changes for later prompts in the same turn.
- Run prompts `00` through `36` in order. Prompts `37` and `38` are optional and require explicit user approval; never infer approval from completing prompt `36`.
- Respect each prompt's mode. A read-only or planning prompt authorizes no implementation beyond the deliverable explicitly named by that prompt.
- Before each prompt, inspect the current repository and prerequisites. Preserve existing user changes; do not reset, revert, stash, discard, or overwrite them merely to obtain a clean tree.
- Preserve the existing wholesale workflow throughout the expansion. Do not weaken PackGuard, deterministic Decimal/NUMERIC calculations, provider boundaries, provenance/freshness/completeness, tenant isolation, security, or idempotent retry behavior.
- Treat unavailable paid providers and live credentials honestly: implement only the boundary, entitlement state, mocks/recorded fixtures, tests, and truthful UI allowed by the requested prompt. Never present mock data as live.
- Complete the requested prompt's acceptance criteria, focused verification, documentation, and final diff review before recommending progression.
- At the end of a numbered prompt, stop, report outcomes and remaining blockers, identify the next prompt, and ask the user whether to continue. Never auto-run the next prompt.
- Merely reading or updating the prompt pack does not authorize any numbered prompt or product-stage work.
