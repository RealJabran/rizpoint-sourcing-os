# ADR-0014: SP-API credentials and execution stay worker-only

## Decision

`PROVIDER_MODE=mock` remains a local-development safety override, not tenant connection state. Runtime selection is organization + marketplace + active connection + entitlement. A connected organization resolves live SP-API; an unconnected production organization receives an explicit not-connected state. Fixtures are available only in explicit local demo mode, and a failed live connection never falls back to them.

SP-API LWA client credentials and the credential-encryption key are supplied to the worker only; the web container receives neither. Long-lived refresh tokens are encrypted in PostgreSQL using AES-256-GCM and authenticated organization/connection data. Short-lived LWA access tokens are cached only in worker memory for a conservative lifetime and concurrent refreshes use one in-flight exchange.

Website OAuth uses a second asymmetric boundary. The web holds only a callback-code RSA public key. After one-time CSRF state consumption, it encrypts the short-lived authorization code and queues an ID-only outbox event. Only the worker holds the private key and LWA client secret, performs the authorization-code exchange, encrypts the refresh token, and discards the access token. The self-authorized owner flow remains a server-side CLI import because browser credential entry adds unjustified exposure.

The typed transport accepts only the documented NA/EU/FE production endpoints, classifies unauthorized, forbidden, throttled, invalid-request, transient, and provider-outage outcomes, reads optional rate-limit headers, and never includes provider payloads in thrown errors. Headers, URLs, and payload fields matching the documented sensitive names are redacted before any future logging boundary.

Every connection validation calls the read-only Sellers `getMarketplaceParticipations` operation. Normalized participations are stored per connection and become the organization's marketplace source of truth. Provider payloads remain inside the worker boundary.

## Consequences

Browser routes expose only normalized connection states, a masked seller identity, participations, capability states, timestamps, and concise error codes—never credential material or raw provider responses. Existing mock/recorded providers remain deterministic for ordinary local and CI tests and are always labeled as fixtures.

Live catalog, pricing, fees, restrictions, batching, caching, and rate-budget behavior remain separate follow-on slices behind the existing provider contracts. A connection that cannot be validated is explicit; it must not fall back to mock data.
