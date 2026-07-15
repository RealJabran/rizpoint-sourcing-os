# Local catalog import testing

Copy `.env.example` to an ignored `.env`, then start the local stack:

```bash
docker compose up --build --wait --wait-timeout 300
```

Open `http://localhost:3000/uploads`, select the seeded `VSI` supplier, and upload CSV, XLSX, or XLS. Browser uploads use `S3_PUBLIC_ENDPOINT` (local: `http://localhost:9000`); web and worker use the internal `S3_ENDPOINT` (`http://minio:9000`). The bucket is private and signed URLs expire after five minutes.

Run the full API pipeline and browser coverage against the running stack:

```bash
pnpm test:integration
pnpm test:browser
```

`test:browser` uses the installed Chrome channel by default. Set `PLAYWRIGHT_BROWSER_CHANNEL=chromium` only when a managed Playwright Chromium binary has been installed. The tests generate in-memory synthetic catalogs and never print signed URLs.

If inspection exhausts its transient scanner retry budget, the upload page shows
an actionable **Retry inspection** button. It reuses the existing private object
and queues a new deterministic run attempt; do not upload the same catalog again.
