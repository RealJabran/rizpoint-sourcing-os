# ADR-0018: Provider runtime truth layer

## Status

Accepted — 2026-08-16

## Context

Amazon scan enrichment already had encrypted credentials, typed observations,
retry handling, and scan-scoped provider attempts. Research providers need a
provider-neutral way to represent capability entitlement, credit windows,
deduplicated requests, cache freshness, health, partial data, and call cost.
Extending Amazon enums for every licensed vendor would misrepresent identity
and make unavailable facts difficult to explain.

## Decision

- Keep capability contracts vendor-neutral and enumerate the supported data
  classes, while provider keys remain strings.
- Store entitlement state per organization, provider, marketplace, and
  capability with explicit `MOCK` or `LIVE` origin.
- Store only encrypted credential envelopes in the generic credential table.
  Decryption remains inside server-side provider adapters.
- Reserve request/credit/token budgets atomically with NUMERIC fields and an
  idempotent request key. Exhaustion records a recoverable state and retry time.
- Cache normalized private projections by sanitized request hash. Each entry has
  observation, fresh, stale-while-revalidate, and retention deadlines; older
  retries cannot overwrite newer observations.
- Use short request leases for concurrent deduplication and sanitized attempt
  telemetry for health, retries, cache outcomes, and optional credit/cost
  accounting. Telemetry has no provider payload column.
- Preserve scan-bound and research observation tables as the evidence truth.
  The runtime layer controls calls and availability; it does not replace raw or
  normalized observations.
- Dual-record existing SP-API attempts into normalized telemetry while keeping
  the legacy scan audit stable.

## Consequences

Future licensed providers can be added without changing wholesale provider
interfaces or presenting mock data as live. UI/API consumers can explain why a
metric is missing. More rows and state transitions require retention jobs and
operational dashboards in later prompts. The rollback is additive-only but
destructive to provider-runtime cache, budget, credential, and telemetry state,
so it requires backup review outside disposable environments.
