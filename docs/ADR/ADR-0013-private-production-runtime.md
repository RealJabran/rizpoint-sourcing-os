# ADR-0013: Private production runtime and recovery

## Decision

Private production runs containerized web, worker, and scanner services behind TLS with managed PostgreSQL, Redis, and private S3-compatible storage. PostgreSQL and private objects are backed up independently; Redis is non-canonical and stale published work is recovered from PostgreSQL outbox/checkpoint state. Private production originally used Auth.js credentials for one owner organization, revalidating active membership and session epoch at the proxy boundary. Prompt 36G extends that boundary to named users, mandatory TOTP, durable sessions and lockout, password lifecycle, and centralized least-privilege roles without changing the private-organization deployment decision. Export retention starts in persisted report mode and deletion requires an explicit deployment setting.

## Consequences

Demo mode is local-only. Production startup rejects placeholder configuration, mock malware scanning, HTTP callback URLs, and missing server-side secrets. Rollback is application-first; destructive database rollback requires a verified restore point.
