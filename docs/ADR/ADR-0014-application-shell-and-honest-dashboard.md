# ADR-0014: Application shell and honest dashboard

## Status

Accepted

## Context

The Phase 0–7 UI exposed individual vertical slices but did not provide a coherent product shell or a truthful entry point into the sourcing workflow. A dashboard must not infer commercial outcomes from incomplete data.

## Decision

The web application uses a responsive shared shell with persistent primary navigation and a mobile drawer. The dashboard shows only organization-scoped persisted scan counts and recent scan summaries. It does not show revenue, profit, winners, or provider health claims unless a persisted contract supplies them.

The dashboard uses additive read-only API routes. Presentation components map persisted state to labels, tone, and progress; calculations, provider access, and tenant selection remain outside the component layer. Existing vertical-slice routes remain available while later UX slices replace their individual surfaces.

## Consequences

- The dashboard remains useful in an empty workspace and cannot fabricate business outcomes.
- A scan list is now available without exposing cross-organization data.
- Global analysis and purchase-order index routes are explicitly scoped placeholders until their underlying list workflows are implemented.
- Later slices can adopt the tokens and components without changing financial, matching, or provider code.
