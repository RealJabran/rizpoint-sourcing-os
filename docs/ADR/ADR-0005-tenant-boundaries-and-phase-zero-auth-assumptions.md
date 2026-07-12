# ADR 0005: Tenant boundaries before authentication UI

## Decision

All tenant-owned records contain `organization_id`, and repositories require organization context. Phase 0 uses a seeded synthetic organization instead of authentication; mock routes require explicit `PHASE_ZERO_DEMO_MODE=true` opt-in.

## Consequences

Authentication is deferred without allowing future data access to bypass tenant scoping. The demo flag is local-development infrastructure, not a production authorization mechanism.
