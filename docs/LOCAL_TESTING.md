# Local catalog import testing

Copy `.env.example` to an ignored `.env`, then start the local stack:

```bash
docker compose up --build --wait --wait-timeout 300
```

Open `http://localhost:3000/uploads`, select the seeded `VSI` supplier, and upload CSV, XLSX, or XLS. Browser uploads use `S3_PUBLIC_ENDPOINT` (local: `http://localhost:9000`); web and worker use the internal `S3_ENDPOINT` (`http://minio:9000`). The bucket is private and signed URLs expire after five minutes.

Confirm the suggested mapping only after reviewing required identifiers, title, cost, and case/pack fields. **Start scan** then runs the full fixture workflow through deterministic calculations. The final action opens the persisted analysis rows; unmatched, review-required, and PackGuard-blocked rows remain visible rather than disappearing from the result set.

Run the full API pipeline and browser coverage against the running stack:

```bash
pnpm test:integration
pnpm test:browser
```

The integration command runs browser-facing signed-upload checks from the host,
then runs the fee/restriction persistence and tenant-filter check in a one-off
worker container because PostgreSQL is intentionally not published to the host.
Run it only after the Compose images have been built from the current worktree.

`test:browser` uses the installed Chrome channel by default. Set `PLAYWRIGHT_BROWSER_CHANNEL=chromium` only when a managed Playwright Chromium binary has been installed. The tests generate in-memory synthetic catalogs and never print signed URLs.

For release-scale database evidence, start Compose and run `pnpm test:scale`.
It creates and removes isolated synthetic 5,000-, 20,000-, and 50,000-row
analysis scans, then verifies a bounded filtered 100-row server window at each
size. Record its timings with the browser-scale evidence for the release gate.

Compose intentionally runs `next start` with `NODE_ENV=production`, so its CSP does not include `unsafe-eval`. Direct `pnpm dev` receives the development-only CSP exception required by React debugging. Browser-extension attributes such as `bis_skin_checked`, `bis_register`, and `cz-shortcut-listen` are not application output; verify hydration behavior in the clean Playwright context rather than suppressing warnings.

If inspection exhausts its transient scanner retry budget, the upload page shows
an actionable **Retry inspection** button. It reuses the existing private object
and queues a new deterministic run attempt; do not upload the same catalog again.
