# RizPoint Research Companion

Manifest V3 Chrome/Chromium companion. It reads only the active Amazon URL,
extracts a URL ASIN when present, and sends it to `/api/research-companion`.
It has no provider credentials, no broad host permissions, and no DOM scraping.
Create a 15-minute token from the authenticated RizPoint web session endpoint
`POST /api/research-companion/session`. The token is kept in extension session
storage and is cleared with the browser session; the non-secret backend origin
and optional project ID use local storage. Backend origins must use HTTPS,
except loopback HTTP for local development. Load this folder unpacked after
`pnpm --filter @rizpoint/research-companion build`.
