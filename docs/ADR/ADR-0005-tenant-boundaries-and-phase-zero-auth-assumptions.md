# ADR 0005: Tenant boundaries before authentication UI

## Decision

All tenant-owned records contain `organization_id`, and repositories require organization context. Phase 0 uses a seeded synthetic organization instead of authentication; mock routes require explicit `PHASE_ZERO_DEMO_MODE=true` opt-in. Phase 6 private workflow routes additionally require a server-only `RIZPOINT_PRIVATE_ACCESS_TOKEN`, except for the explicit local Compose demo exception.

## Consequences

Identity-aware authorization is deferred without allowing future data access to bypass tenant scoping. The temporary private-access token is a deployment gate, not a replacement for organization membership or roles; those remain required before multi-user release.
