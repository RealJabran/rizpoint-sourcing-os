# Security

## Threat model and boundaries

The browser is untrusted. Web routes enforce an organization context before querying or mutating tenant-owned state. PostgreSQL is canonical; Redis is transient queue transport. Scanner and object storage are private services.

## Phase 1 controls

- Environment templates contain placeholders only; all real `.env*` files are ignored and CI rejects them.
- Supplier files, exports, local object-store data, and test-private fixtures are ignored.
- Every tenant-owned query is scoped by `organization_id`. Phase 0 mock routes require explicit local-demo opt-in and must not be exposed as an authentication substitute. Phase 6 private routes require the server-side `RIZPOINT_PRIVATE_ACCESS_TOKEN` outside the explicit local-compose demo exception; browser access can use an HttpOnly `rizpoint_private_access` cookie.
- MinIO is configured as a private bucket. Browser upload uses a five-minute signed URL and an origin-scoped local CORS rule.
- Uploads are limited to 50 MiB using object-store metadata before bytes are downloaded. CSV/XLS/XLSX filename and file signature must agree; XLSX archive expansion, sheet, row, and column limits reject rather than truncate.
- Inspection fails closed unless ClamAV reports a clean file. `MALWARE_SCAN_MODE=mock` is test-only and must not be used in a deployed environment.
- Spreadsheet values are treated as data, never formulas. Formula-like input cells are retained as source evidence and flagged. Exports prefix textual cells beginning (including after whitespace) with `=`, `+`, `-`, `@`, tab, carriage return, or newline; numeric cells remain numeric. Exports are allowlisted, private, checksummed, and returned through a five-minute tenant-authorized signed download URL.
- The tenant-authorized export route checks persisted expiry before minting a signed URL; missing or expired expiry fails closed even before the retention worker deletes the object.
- Human match review requires a reason and idempotency key. It writes an organization-scoped audit event, and a known brand/model/size/pack/variation contradiction remains non-buyable after review.
- The worker records only synthetic metadata in Phase 0 and redacts credential-shaped error text before logging.
- External provider contracts require provenance/freshness and never expose credential fields to the browser.
- Analysis filters and sort keys are allowlisted; evidence payloads are loaded only through tenant-scoped result-detail routes. Inline cost/stress edits require an idempotency key, revision, and reason, and retain an audit event rather than mutating supplier or provider evidence.
- CI rejects spreadsheets outside the synthetic fixture allowlist, preventing accidental supplier-catalog commits.

## Required before production rollout

- Replace the temporary private-access token with identity-aware, organization membership authorization and roles before any multi-user release.
- Keep formula-injection export tests in CI. Textual export cells beginning with `=`, `+`, `-`, `@`, tab, carriage return, or newline are already escaped.
- Provider refresh tokens are encrypted at rest with AES-256-GCM and versioned `PROVIDER_CREDENTIAL_KEY_V1`; this key is server/worker-only and must be supplied by the deployment secret manager. Browser APIs expose connection status only, never token material.
- Add authentication, authorization tests, audit logging, retention/deletion controls, and operational incident procedures.

## Amazon SP-API private-application onboarding

Phase 7.6 keeps `PROVIDER_MODE=mock` as the default. Live SP-API connectivity is a worker-only, explicitly opted-in boundary; it does not enable catalog, pricing, or enrichment behavior by itself.

1. Register a **private** application in the Amazon Solution Provider Portal and request only the roles needed for the intended use. The initial read-only connection probe uses `getMarketplaceParticipations` from the Sellers API; Amazon currently documents `Product Listing` as one of the permitted roles in NA/EU/FE. Do not request restricted-data roles for this product workflow.
2. As the Seller Central primary user, open **Develop Apps**, choose the private application, and choose **Authorize app** for the seller account. Amazon displays a refresh token for each authorization. Treat it as a password: it is long-lived, must not enter a URL, browser, terminal history, log, test snapshot, or Git.
3. View the application's LWA client ID and client secret in the Solution Provider Portal. Amazon requires runtime token exchange at `https://api.amazon.com/auth/o2/token` with `grant_type=refresh_token`, client ID, client secret, and refresh token. The application keeps only the resulting short-lived access token in worker memory.
4. Create an ignored, owner-only local secret file such as `.env.sp-api.local` (all `.env*` files are ignored) with placeholder variable names from `.env.example`; set mode `0600`. It may contain `SP_API_LWA_CLIENT_ID`, `SP_API_LWA_CLIENT_SECRET`, `SP_API_REFRESH_TOKEN`, `SP_API_MARKETPLACE_ID`, `SP_API_SELLER_ID`, `SP_API_ENDPOINT`, `PROVIDER_CREDENTIAL_KEY_V1`, `DATABASE_URL`, and `RIZPOINT_PRIVATE_ORGANIZATION_SLUG`. Never add these values to `compose.yaml`, `apps/web/.env*`, or a `NEXT_PUBLIC_*` variable.
5. From a private terminal, load the ignored file and run one server-side, non-destructive validation: `set -a; source .env.sp-api.local; set +a; SP_API_LIVE_SMOKE=1 pnpm --filter @rizpoint/amazon-sp-api test -- live-smoke`. This test is skipped in CI unless the explicit opt-in flag is present. It calls only `GET /sellers/v1/marketplaceParticipations` and prints no provider payload.
6. After a successful smoke test, run `pnpm sp-api:connect` from the same private environment. It encrypts the refresh token with AES-256-GCM using organization-and-connection authenticated data before writing it to PostgreSQL. It prints only `SP_API_CONNECTION_STATUS=<status>`. The normal Compose runtime does not receive `SP_API_REFRESH_TOKEN`; the worker decrypts the persisted credential only when `PROVIDER_MODE=sp_api` and the organization connection is active.
7. Rotate the LWA client secret on Amazon's required schedule, update only the deployment secret manager/ignored local file, and run the opt-in smoke check before retiring the previous secret. On suspected exposure, revoke or rotate the relevant Amazon credential and follow Amazon's incident process.

The Amazon authorization instructions above are based on Amazon's current [private application self-authorization guide](https://developer-docs.amazon.com/sp-api/docs/self-authorization), [Sellers API role mapping](https://developer-docs.amazon.com/sp-api/lang-tr_TR/docs/sellers-api), and [LWA credential guidance](https://developer-docs.amazon.com/sp-api/docs/lwa-credentials-faq). Amazon may change roles and access terms; confirm them in the official portal before enabling live mode.

## Phase 7 private-production controls

- Private production validates the signed Auth.js session against the active owner membership and session epoch on every protected request. Demo mode is local-only; a production request rejects it before routing.
- Production configuration is fail-closed for placeholders, weak session secrets, non-TLS database/Redis/storage endpoints, disabled malware scanning, missing private organization context, and missing storage encryption/versioning/lifecycle declarations.
- Worker logs redact credential-shaped text and payload-bearing fields. Private production requires an HTTPS error-tracking collector and sends it only allowlisted IDs, release, event code, and redacted message. Metrics use IDs and counters only; supplier sheets, price rows, tokens, and raw provider payloads are never sent.
- PostgreSQL requires PITR plus tested encrypted backups. The application verifies private bucket versioning, encryption, and lifecycle configuration at production readiness; Redis is recoverable transport, not business truth.
- Export retention persists report-mode candidates as audit events before deletion is enabled. Deleted export objects retain an audit event. Production recovery and Sev-1 response are documented in `RECOVERY_RUNBOOK.md`.
- Development CSP permits `unsafe-eval` only for Next.js/React developer tooling. Production CSP never includes it. Browser-extension attributes are diagnosed in a clean, extension-free browser context; the application does not suppress hydration warnings.
- The local Compose demo uses a production-built Next.js server but is accepted only when both demo flags and loopback application/auth URLs are present; published web and MinIO ports bind to loopback. Private production still rejects demo mode before routing.
