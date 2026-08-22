# Amazon connection runbook

RizPoint supports two Amazon SP-API authorization modes. `SELF_AUTHORIZED` is
the supported path for the private owner installation. `OAUTH` is code-ready
for a future public Amazon application, but cannot be used live until Amazon
has issued and configured that public application's credentials and URLs.

The integration workspace is at **Settings → Integrations → Amazon**. It shows
only a masked seller identity, region, discovered marketplaces, connection
timestamps, normalized errors, and capability states. It never returns an LWA
client secret, refresh/access token, encrypted credential envelope, OAuth code,
or raw Amazon response.

## Private owner: self-authorization

These are the actions the RizPoint owner must perform outside the application:

1. Sign in to the [Amazon Solution Provider Portal](https://solutionproviderportal.amazon.com/). Locate or register the private RizPoint SP-API application. Request only the roles needed by the existing read-only operations: Sellers marketplace participations plus the applicable Product Listing/Pricing roles for Catalog Items, competitive pricing, product fees, and listings restrictions. Confirm Amazon's current role mappings before changing roles.
2. Open **Manage Authorizations** in Solution Provider Portal and use its Seller Central sign-in link, or locate the private application from Seller Central. Sign in as the Seller Central **Primary User**, choose **Authorize app**, and copy the newly displayed refresh token into a protected secret manager or an owner-only file. Amazon's current self-authorization guide says a refresh token is generated for each authorized account.
3. In the Solution Provider Portal application registration, obtain the LWA client ID and client secret. Record the seller/merchant ID and choose one seed marketplace ID in the account's region. The seed is only for onboarding; after validation RizPoint uses Sellers `getMarketplaceParticipations` as the user-facing marketplace source.
4. On the RizPoint server, create an ignored file such as `.env.sp-api.local`, set mode `0600`, and supply:

   ```text
   DATABASE_URL=...
   RIZPOINT_PRIVATE_ORGANIZATION_SLUG=...
   SP_API_LWA_CLIENT_ID=...
   SP_API_LWA_CLIENT_SECRET=...
   SP_API_REFRESH_TOKEN=...
   SP_API_SELLER_ID=...
   SP_API_MARKETPLACE_ID=ATVPDKIKX0DER
   SP_API_ENDPOINT=https://sellingpartnerapi-na.amazon.com
   PROVIDER_CREDENTIAL_KEY_V1=...
   ```

   Use the matching NA, EU, or FE endpoint. Do not put these values in a web
   environment, a `NEXT_PUBLIC_*` variable, a URL, a command argument, logs,
   analytics, test fixtures, or Git.

5. Load the protected environment without echoing it and run:

   ```sh
   set -a
   source .env.sp-api.local
   set +a
   pnpm sp-api:connect
   ```

   The command exchanges the refresh token only server-side, calls Sellers
   `getMarketplaceParticipations`, encrypts the refresh token with AES-256-GCM
   and organization/connection authenticated data, persists the discovered
   marketplaces and capability boundary, and prints only
   `SP_API_CONNECTION_STATUS=CONNECTED`.

6. Remove the raw refresh token from the process environment and protected
   import file when the deployment secret procedure permits. The normal worker
   needs the LWA client credentials and credential-vault key, but not the raw
   imported refresh token. Return to the Amazon integration page; it detects
   the organization connection automatically. Choose an accessible active
   marketplace and run **Test connection**.

RizPoint deliberately does not provide a browser form for a self-authorized
refresh token. A browser import would add exposure through browser memory,
extensions, request inspection, reverse proxies, analytics, or accidental
client persistence. The secure CLI is therefore the supported credential-import
boundary; no database editing is required.

Disconnecting in RizPoint erases the local encrypted credential and marks its
capabilities unauthorized. It does not contact Amazon to revoke authorization.
When access must be fully revoked, also revoke the application authorization in
Solution Provider Portal/Seller Central.

## Future external organizations: website OAuth

Before enabling live OAuth, register RizPoint as a public SP-API application
and configure Amazon with these exact HTTPS endpoints:

- Log-in URI: `https://YOUR_RIZPOINT_HOST/api/providers/amazon/oauth/login`
- Redirect URI: `https://YOUR_RIZPOINT_HOST/api/providers/amazon/oauth/callback`

Set the following through deployment configuration:

- Web-safe configuration: `SP_API_APPLICATION_ID`,
  `SP_API_OAUTH_ENABLED=true`, `SP_API_OAUTH_REDIRECT_URI`, `SP_API_OAUTH_CALLBACK_PUBLIC_KEY`,
  `SP_API_OAUTH_CALLBACK_KEY_VERSION`, and `SP_API_OAUTH_DRAFT`.
- Worker-only secrets: `SP_API_LWA_CLIENT_ID`,
  `SP_API_LWA_CLIENT_SECRET`, `PROVIDER_CREDENTIAL_KEY_V1`, and
  `SP_API_OAUTH_CALLBACK_PRIVATE_KEY`.

Generate a dedicated RSA key pair (2048 bits or stronger). Put only the public
key in the web service. Put only the private key in the worker secret manager.
Rotate by deploying both sides under a new positive key version after all
in-flight authorizations have completed.

The implemented workflow follows Amazon's current website authorization flow:

1. RizPoint generates 32 random bytes, stores only the SHA-256 state
   representation with organization, seed marketplace/region, return path, and
   a ten-minute expiry, then redirects to the regional Seller Central
   `/apps/authorize/consent` URI using only `application_id`, `state`, and
   optional draft `version=beta`.
2. The authenticated log-in URI validates Amazon's `amazon_callback_uri`,
   binds `selling_partner_id` to the tenant's pending state, generates a fresh
   state, and redirects only to an allowlisted Amazon
   `/apps/authorize/confirm/` URI with `redirect_uri`, `amazon_state`, `state`,
   and optional `version=beta`.
3. The redirect callback validates and atomically consumes state. Replay,
   expiry, unknown state, and seller mismatch fail closed. The five-minute LWA
   authorization code is immediately encrypted with RSA-OAEP-SHA256; plaintext
   is never written to PostgreSQL or Redis.
4. The worker decrypts the one-time code, exchanges it at LWA with
   `grant_type=authorization_code`, encrypts the returned refresh token, never
   persists the access token, validates Sellers marketplace participations,
   and records authorization/re-authorization audit events.

OAuth is code-ready but not validated against a live public Amazon application
in this repository. Publication, Amazon review, live credentials, provider
terms, and a real seller authorization remain external release gates.

## Runtime and failure semantics

Provider selection is organization + marketplace + connection + entitlement.
An active organization connection selects live Amazon regardless of the old
global provider flag. An unconnected production organization receives an
explicit not-connected/unauthorized state. Recorded fixtures are allowed only
when `PHASE_ZERO_DEMO_MODE=true` and `PROVIDER_MODE=mock`, and a failed,
revoked, or throttled live connection never falls back to them.

Validation is queued and idempotent. Throttling or provider failure preserves
prior observations and last-success timestamps. Discovered marketplace changes
are tenant-scoped, timestamped, and become the source for the application
marketplace selector.

Official references: [Amazon website authorization workflow](https://developer-docs.amazon.com/sp-api/docs/website-authorization-workflow), [self-authorization](https://developer-docs.amazon.com/sp-api/docs/self-authorization), [Seller Central URLs](https://developer-docs.amazon.com/sp-api/docs/seller-central-urls), and [Sellers getMarketplaceParticipations](https://developer-docs.amazon.com/sp-api/reference/getmarketplaceparticipations).
