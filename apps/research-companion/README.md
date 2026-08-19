# RizPoint Research Companion

Manifest V3 Chrome/Chromium companion. It reads only the active Amazon URL,
extracts a URL ASIN when present, and sends it to `/api/research-companion`.
It has no provider credentials, no broad host permissions, and no DOM scraping.
Create a 15-minute token from the authenticated RizPoint web session endpoint
`POST /api/research-companion/session`, then load this folder unpacked after
`pnpm --filter @rizpoint/research-companion build`.
