# ADR-0014: SP-API connectivity stays worker-only and mock-first

## Decision

`PROVIDER_MODE=mock` remains the default. The canonical live mode is `sp_api` (with temporary acceptance of the older `sp-api` spelling). SP-API LWA client credentials and the credential-encryption key are supplied to the worker only; the web container receives neither. Long-lived refresh tokens are encrypted in PostgreSQL using AES-256-GCM and authenticated organization/connection data. Short-lived LWA access tokens are cached only in worker memory for a conservative lifetime and concurrent refreshes use one in-flight exchange.

The typed transport accepts only the documented NA/EU/FE production endpoints, classifies unauthorized, forbidden, throttled, invalid-request, transient, and provider-outage outcomes, reads optional rate-limit headers, and never includes provider payloads in thrown errors. Headers, URLs, and payload fields matching the documented sensitive names are redacted before any future logging boundary.

The first connection probe is server-side only and calls the read-only Sellers `getMarketplaceParticipations` operation. It is opt-in and excluded from CI. It establishes authorization and transport health without implementing catalog, pricing, or enrichment behavior.

## Consequences

Browser routes expose only a normalized connection status (`Mock`, `Connected`, `Misconfigured`, `Unauthorized`, `Throttled`, or `Unavailable`) and timestamps/error codes, never credential material. Existing mock/recorded providers remain deterministic for all ordinary tests.

Live catalog, pricing, fees, restrictions, batching, caching, and rate-budget behavior remain separate follow-on slices behind the existing provider contracts. A connection that cannot be validated is explicit; it must not fall back to mock data.
