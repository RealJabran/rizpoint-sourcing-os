# Live private pilot report

Report date: 2026-08-23

Environment: private local Docker Compose deployment

Release classification: **private engineering candidate — live pilot blocked**

This is the sanitized operational record for Prompt 36F. It is intentionally
not a fixture result and does not count recorded/demo responses as Amazon
evidence. The report may be promoted to **PRIVATE LIVE BETA** only after every
required live and private-data row below passes.

## Current preflight result

The credential-free preflight is complete. The application API currently
reports:

| Check                         | Sanitized result                          |
| ----------------------------- | ----------------------------------------- |
| Amazon connection             | `NOT_CONNECTED`                           |
| Data origin                   | `NONE`                                    |
| Local demo boundary           | Enabled and visibly labeled               |
| OAuth public-app availability | Not configured                            |
| Self-authorized connection    | Not present                               |
| Connected marketplaces        | None                                      |
| Private supplier pilot asset  | Not present in the ignored pilot location |

The host process has no Amazon onboarding values loaded. The worker has an
SP-API regional endpoint but no LWA client identifier, LWA client secret, or
credential-vault key. Presence was checked without printing or reading any
secret value.

This is the correct fail-closed outcome. No live validation was attempted, no
mock response was accepted as live, and no provider capability is reported as
authorized.

## Live Amazon capabilities

| Capability / operation            | Status                | Evidence             |
| --------------------------------- | --------------------- | -------------------- |
| Sellers marketplace participation | Pending authorization | No live request made |
| Catalog Items ASIN lookup         | Pending authorization | No live request made |
| Catalog Items identifier lookup   | Pending authorization | No live request made |
| Catalog Items keyword search      | Pending authorization | No live request made |
| Competitive offer data            | Pending authorization | No live request made |
| Product fee estimate              | Pending authorization | No live request made |
| Listings restrictions             | Pending authorization | No live request made |

Historical market data, keyword volume, reverse-ASIN ranks, search-rank
history, and modeled sales are not Amazon SP-API capabilities. They remain
provider-dependent and must not be inferred from this pilot.

## Real ASIN pilot

Status: **not started — Amazon authorization required**

Planned bounded universe: 10–25 ASINs discovered from a live, connected-market
Catalog Items keyword search, with a fixed sanitized list recorded here after
selection. Each product will be checked for catalog identity, marketplace,
offers when returned, explicit fee scenario, seller-specific restrictions,
source, observation time, freshness, and completeness. Missing fields will
remain missing.

| Measure                            | Current value |
| ---------------------------------- | ------------: |
| Real ASINs attempted               |             0 |
| Real ASINs persisted               |             0 |
| Live Amazon observations persisted |             0 |
| Partial/missing products           |  Not measured |

## Real wholesale pilot

Status: **not started — private supplier file and Amazon authorization
required**

No supplier file was found under the ignored `fixtures/private/` boundary.
The future result must cover upload, mapping, normalization, deterministic
matching, PackGuard, live Amazon enrichment, scenario-bound fees,
seller-specific restrictions, Decimal profit, analysis, shortlist, and private
export. Supplier rows, filenames, prices, and outputs must not be copied into
this report or Git.

## Cache proof

Status: **not started — requires persisted live observations**

The pilot will record a telemetry window for the fixed ASIN set:

| Pass                            | Required proof                                        | Result  |
| ------------------------------- | ----------------------------------------------------- | ------- |
| First                           | Provider calls and cache misses recorded              | Pending |
| Second, while fresh             | Zero calls or an operation-specific justified minimum | Pending |
| Third, after web/worker restart | Persisted fresh cache still reused                    | Pending |
| Forced refresh, one ASIN        | New observation time and forced-refresh attempt       | Pending |

Provider telemetry will be reported as aggregate counts only. Request IDs,
seller identity, raw responses, catalog titles, and credentials will not be
written here.

## Failure and recovery pilot

Status: **not started against the live connection**

The safe live exercises are token revocation/reauthorization, a bounded
throttle response if naturally observed, temporary provider failure, partial
or missing response, worker restart, Redis restart, stale-cache reuse, and
missing data. Tests must prove that existing observations survive and that no
failure becomes zero or mock evidence. Destructive token manipulation and
artificial provider request storms are prohibited.

## Browser journey

Status: **not started against live Amazon**

The required journey is login → Amazon integration → marketplace selection →
product research → bounded keyword catalog discovery → save/open project →
evidence → private wholesale scan → analysis → shortlist → export. It must be
completed without SQL, Prisma Studio, or copied internal identifiers.

## Security observations

- The Amazon status endpoint returned only normalized connection state.
- No credential value was printed, read from a browser, or placed in a URL.
- `.env*` and `fixtures/private/` are ignored by Git.
- The current unconnected organization remained in an explicit demo boundary;
  demo evidence was not counted toward this gate.
- No supplier private data was present or added to the repository.

## Performance and workflow results

No live-provider latency, call volume, cache ratio, wholesale throughput, or
browser journey duration is reported yet. Fixture and scale-gate results from
earlier release work are not substituted for this live pilot.

## Exact secure resume checkpoint

The smallest owner action is:

1. Self-authorize the private RizPoint SP-API application for the Seller
   Central account with the Product Listing and Pricing roles, then obtain the
   resulting refresh token, LWA client identifier, and LWA client secret.
2. Put the values in the ignored owner-only `.env.sp-api.local` described in
   [Amazon connection](AMAZON_CONNECTION.md), set mode `0600`, load it without
   echoing it, and run `pnpm sp-api:connect`. Do not paste the values into chat.
3. Place one real supplier CSV/XLS/XLSX at
   `fixtures/private/live-pilot/supplier-catalog.xlsx` (or report only the path
   to another ignored private file). Do not add it to Git.

After the Amazon integration page shows connected, report only **Amazon
connected** and the private supplier-file path. The pilot can then resume from
marketplace discovery without database editing or additional secret handling.

## Remaining blockers

- Private Amazon seller authorization and worker-side LWA/vault secrets.
- One ignored real supplier catalog suitable for a bounded sourcing pilot.
- Live capability, ASIN, cache, failure/recovery, wholesale, and browser
  results.
- A successful two-week real-user operational pilot remains separate from this
  bounded technical gate if the release audit continues to require it.

Prompt 37's reliability prerequisite is **not satisfied** at this checkpoint.
