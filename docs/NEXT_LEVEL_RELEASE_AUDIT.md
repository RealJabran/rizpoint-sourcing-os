# Next-level release audit

Audit date: 2026-08-22

Scope: Prompts 00–36 and the preserved wholesale workflow

Decision: **private engineering candidate; not production-ready**

## Executive result

RizPoint is a coherent evidence-first sourcing and research operating system at
the architecture, deterministic-calculation, fixture, and private-workflow
level. Wholesale remains the strongest end-to-end journey. Research shares its
tenant boundary, product identity, provider runtime, provenance, immutable
decision evidence, job controls, Decimal/NUMERIC policy, and release gates
instead of creating a parallel truth system.

This audit does **not** establish production readiness, market-wide coverage, or
commercial fitness. Most market-wide keyword, rank, category, brand, seller,
advertising, review, and behavioral relationship capabilities still require a
reviewed licensed provider. Sales-estimation quality has synthetic evaluation
coverage but no sufficiently large live marketplace/category holdout. The
expanded workflows have not completed a real-user private pilot. Those are
release blockers, not documentation footnotes.

The read-only pass found six integration seams that were safe to
fix without adding a provider or changing a formula:

- a watched product had no Product Tracker destination;
- persisted keyword-rank observations had no web/API read path;
- Research Projects required an opaque copied ID even when Product Explorer or
  Product Tracker already knew the project.
- a cold Compose wholesale normalization run exceeded Prisma's implicit
  five-second interactive-transaction timeout after the scanner had succeeded.
- the mock catalog dropped matching's marketplace context, so the fail-closed
  provider-rights policy correctly blocked a purchase-order export whose catalog
  provenance could not identify a marketplace.
- the matching adapter records its fixture catalog surface as `mock-catalog`,
  while the reviewed synthetic entitlement is intentionally owned by the parent
  `mock-amazon` connection; export rights therefore needed an explicit adapter
  alias rather than a bypass.

Prompt 36 adds bounded, tenant-scoped Product Tracker and Rank Tracker read
views, explicit source/freshness/observation context, Monitoring navigation, and
project deep links. Provider collection remains outside page loads and remains
disabled when entitlement is absent. Normalization now prepares bulk projection
objects before entering its atomic database transaction and uses an explicit
bounded 30-second transaction/10-second acquisition budget. Mock catalog
provenance now retains the requested marketplace so fixture exports exercise
the same marketplace-scoped rights decision as live providers. Export resolves
the mock adapter to that configured parent entitlement and otherwise remains
fail-closed.

## Audit method and decision rules

The audit first inspected the product and architecture documents, migrations,
provider contracts, repositories, routes, user interfaces, worker ownership,
tests, security/data-rights controls, and scale/evaluation baselines. Fixes were
made only after the read-only journey trace was complete.

Capability labels in this document mean:

- **Implemented** — a tenant-scoped runtime path exists with tested deterministic
  or stored behavior.
- **Partial** — useful behavior exists, but a required workflow surface,
  provider, or real-data validation is absent.
- **Provider-blocked** — a typed/capability-gated boundary exists but no reviewed
  live entitlement is configured; fixtures are not counted as live.
- **Not implemented** — no claim is made merely because a schema or prompt
  mentions the capability.

## End-to-end journey audit

| Journey                 | Implemented and connected                                                                                                                                                                                                                                | Incomplete or blocked                                                                                                                                                                                                                                                               | Result                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Wholesale               | Private CSV/XLS/XLSX upload, inspection/mapping, normalized rows, deterministic match cascade, contradiction-safe PackGuard, typed Amazon evidence, `profit-engine/v3`, analysis/views/replay, shortlists, case-aware PO, private safe export            | A production supplier pilot, real account/provider validation, recovery exercise, and long-running user acceptance remain operational exit criteria. Live SP-API exposes account-authorized evidence, not global market truth.                                                      | Implemented for fixture/private validation; not production-validated |
| Private-label discovery | Tracked-universe category browser, Product Explorer, licensed-history boundary and analytics, provenance/model-bound sales ranges, decomposable niche assessment, Research Project, supplier quote scenarios, compliance screen, immutable Decision Memo | Seed-keyword/category breadth is limited to stored evidence without licensed providers. There is no global Amazon catalog or market-size claim. Upstream selections do not yet prefill every downstream quote/compliance/memo input.                                                | Useful partial journey                                               |
| Keyword                 | Stored keyword explorer, phrase-preserving normalization, reverse-ASIN deterministic gap math, persisted rank analytics/read view, fact-bound listing builder                                                                                            | No licensed keyword/rank provider is bundled. No new rank jobs can collect without entitlement. Official ABA/SQP UI/boundary is present but no eligible live report orchestration has been validated. Keyword lists do not yet flow into listing drafts as a single guided handoff. | Provider-blocked collection; stored-analysis path implemented        |
| Market                  | Versioned frozen/dynamic market definitions and members, stored market observations, market list, Product Tracker, deterministic entrant/exit foundations, alert rules/events                                                                            | Market detail/timeline, replay, entrants/exits, share, and change-feed screens are not a complete interactive journey. Scheduled collection needs live product/history providers and production queue observation.                                                                  | Partial                                                              |
| Launch                  | Differentiation brief, deterministic listing analysis, fact/evidence-bound listing drafts, private-label economics, stage-gated launch plan, Product Tracker/alerts                                                                                      | Project IDs and verified facts still require deliberate user selection in several workspaces; this is not yet a guided launch cockpit. No external purchase, Seller Central write, or advertising execution is implemented by design.                                               | Implemented modules; partial orchestration                           |
| Extension               | Manifest V3 URL/ASIN detection, marketplace detection, short-lived tenant session, authorized backend analysis, save-to-project/watch, explicit offline/error state                                                                                      | Rich output is null when backend evidence is absent; no prohibited Amazon DOM data engine exists. Multi-select search-page capture is not implemented. Real signed-in browser and backend-origin pilot remains required.                                                            | Safe initial companion implemented                                   |
| Copilot                 | Allowlisted read-only operation selection, tenant predicates, bounded rows, internal evidence IDs, fact/derived/hypothesis/missing separation, imported-text defenses                                                                                    | Deterministic retrieval currently covers niche discovery, decision assumptions, and compliance only. It does not yet answer every example question, and no approved explanation-model provider is configured or model-specifically evaluated.                                       | Safe limited retrieval mode                                          |

## Implemented capability inventory

### Shared trust plane

- one `CatalogProduct` identity shared by wholesale and research;
- organization predicates on tenant-owned repositories and parent/child access;
- typed provider capabilities, entitlements, rate budgets, cache, request leases,
  telemetry, freshness, completeness, and retry state;
- field-level export rights and contractual retention metadata that fail closed;
- private evidence/object-storage boundaries and formula-safe exports;
- idempotent outbox/worker orchestration and bounded provider concurrency;
- marketplace registry with locale, currency, timezone, provider capability, and
  explicit FX observations;
- versioned deterministic history, opportunity, category/niche, rank,
  profitability, compliance, differentiation, and portfolio calculations;
- versioned golden datasets for deterministic research, AI grounding, and
  provider contract failure states.

### Workflow surfaces

- wholesale scan, analysis, shortlist, PO, replay, and export;
- Product Explorer, Category Intelligence, Opportunity Finder, Sales
  Estimation, Product Tracker, Market Tracker, brands/sellers, relationships,
  reviews, and optional advertising states;
- Keyword Explorer, Reverse ASIN, stored Rank Tracker, and first-party Amazon
  eligibility/unsupported state;
- Research Projects, deterministic comparisons, evidence/assumptions, and
  immutable Decision Memos;
- listing analysis/building, differentiation, private-label quote scenarios,
  compliance, portfolio optimization, and Launch Planner;
- in-app alerts, multi-marketplace switcher, Research Companion, and bounded
  Research Copilot.

## Incomplete capability inventory

The following are explicitly outside a release-ready claim:

1. **Live market universe:** no reviewed provider currently supplies an
   Amazon-wide product, keyword, rank, category, brand, seller, advertising,
   review, or behavioral relationship universe.
2. **Market workspace depth:** stored foundations exist, but complete timeline,
   entrants/exits, share, replay, and change-feed interaction remains unfinished.
3. **Scheduled research collection:** general queue primitives, capability
   records, watch/track schedules, and idempotent rank observation writes exist,
   but capability-specific keyword-rank, market, product, and category scheduler
   handlers are not implemented end to end. They require configured providers,
   budget enforcement, retries, and live quota testing.
4. **Official first-party keyword analytics:** eligibility-aware contracts and
   an honest disabled state exist; asynchronous report persistence/orchestration
   is not implemented end to end, and no live eligible ABA/SQP report has passed
   an account validation in this audit.
5. **Guided handoffs:** project deep links now remove the worst copied-ID seam,
   but keyword-to-listing and approved-project-to-launch inputs still need a
   single contextual handoff and prefill review.
6. **Copilot breadth:** three allowlisted retrieval operations do not cover all
   advertised natural-language examples.
7. **Real-data accuracy:** synthetic fixtures pin formulas and exercise failure
   behavior but do not measure Amazon market accuracy, live coverage, or user
   decision quality.
8. **Commercial controls:** role administration, billing, self-service tenant
   deletion, support tooling, and commercial quotas are intentionally deferred
   to optional Prompt 37 and are not authorized by this audit.

## Live provider dependencies and external-data limits

| Data family                             | Current runtime truth                                                                                                         | What cannot be claimed                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Amazon catalog/offers/fees/restrictions | Optional live, account-authorized SP-API adapter; mock is default and labeled                                                 | SP-API is not a global competitor database; lowest offers can be a bounded sample; FBA is not Amazon Retail                 |
| Historical price/rank/offers/reviews    | Optional live licensed Keepa boundary with reviewed rights, credential, budget, cache, and retention; otherwise recorded/mock | Recorded history is not live. BSR is not sales. Missing dates are not zero or interpolation                                 |
| Monthly sales/units                     | Licensed provider estimate or an explicitly calibrated marketplace/category model with version/range/confidence               | No universal BSR-to-sales formula, no exact demand, and no live-quality claim from the three-case synthetic benchmark       |
| Keywords/reverse ASIN/search rank       | Contracts, stored normalized observations, deterministic gap/rank math; no bundled live provider                              | Search volume, organic rank, sponsored rank, CPC, and competing product count are unavailable when not observed             |
| ABA/SQP                                 | Eligibility-aware first-party boundary and disabled UI                                                                        | Not every seller/brand is eligible; unsupported official fields remain unsupported; incompatible windows cannot be compared |
| Category/brand/seller                   | Aggregation over the named tracked organization universe; optional provider contracts                                         | No total category size, ownership inference, seller economics, or Amazon-wide market share                                  |
| Advertising                             | Capability-gated contract and honest configuration state                                                                      | No sponsored placement/CPC/share claim without licensed or authorized first-party evidence; no HTML scraping                |
| Reviews                                 | User-imported or future licensed authorized records with minimization and evidence links                                      | No Amazon review-page scraping and no summary beyond supporting review IDs                                                  |
| Relationships                           | Derived shared-keyword/shared-market similarity unless an authorized relationship source exists                               | Derived similarity is not Amazon “frequently bought together,” “also viewed,” or customer behavior                          |
| Compliance                              | Versioned research-stage rules and explicit `UNKNOWN`                                                                         | Not legal advice, certification approval, clearance, or a universal “no certification required” conclusion                  |
| FX/fees/margins                         | Dated Decimal observations and versioned deterministic engines                                                                | Point-in-time inputs are not guarantees; cross-market values are not comparable without normalization                       |

Mock, recorded, synthetic, user-supplied, first-party account, licensed provider,
derived, and AI-hypothesis data remain distinct in storage and presentation.
Provider errors, absent entitlements, throttles, partial payloads, stale evidence,
and unknown rights never become zero or a silent live fallback.

## Public feature-family comparison

This is a workflow comparison, not a dataset or parity claim. Public official
pages reviewed on 2026-08-22 describe product-database filtering, product and
niche tracking, reverse-ASIN/keyword research, listing workflows, extensions,
and marketplace-dependent availability. See Helium 10's
[tool families](https://www.helium10.com/tools/),
[Black Box](https://www.helium10.com/tools/product-research/black-box/), and
[market support matrix](https://kb.helium10.com/hc/en-us/articles/360036359334-Which-Tools-Are-Supported-in-Which-Markets), plus Jungle Scout's
[Product Database documentation](https://support.junglescout.com/hc/en-us/articles/360008616554-How-to-use-the-Product-Database) and
[Opportunity Finder](https://www.junglescout.com/features/opportunity-finder/).

RizPoint now covers the same broad workflow families, but it deliberately does
not copy proprietary scores or claim the vendors' catalog breadth. Its current
differentiation is an explainable evidence/rights/decision lineage and the
preserved wholesale-to-PO flow. Its current disadvantage is live dataset breadth
and a less complete guided market/keyword workflow. Adding surface area before
validating provider rights, accuracy, and handoffs would reduce trust.

## Measured test and benchmark status

The final Prompt 36 run records command outcomes here. A passing fixture gate is
evidence of code behavior under its stated fixture, not proof of live-market
accuracy or production capacity.

| Gate                         | Prompt 36 result      | Scope / measured limit                                                                                                                                                                       |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                | Passed                | Secret/private-asset checks, hardening, formatting, lint, typecheck, unit tests, builds                                                                                                      |
| `pnpm release-gate:research` | Passed: 32/32         | Versioned golden metrics, AI grounding, provider drift/partial/throttle/entitlement fixtures; synthetic sales sample size 3, MAE 10.00, MAPE 15%, interval coverage 100%                     |
| `pnpm test:integration`      | Passed                | Wholesale pipeline plus tenant/provider/history/research integrations; includes full 4,969-row upload/mapping and fail-closed provider export-rights decisions                               |
| `pnpm test:browser`          | Passed: 9; skipped: 1 | Desktop/mobile shell, runtime failure capture, wholesale upload/recovery; release-scale browser case intentionally belongs to the separate scale command                                     |
| `pnpm test:scale`            | Passed                | 5k: 1,280 ms; 20k: 497 ms; 50k: 2,256 ms server-side analysis fixture windows                                                                                                                |
| `pnpm test:scale:browser`    | Passed: 1/1           | 5k: 5,326 ms; 20k: 8,866 ms; 50k: 9,701 ms; four result windows each, 19,370,084-byte peak JS heap, 856,473 KiB peak Compose web/worker memory                                               |
| `pnpm test:research-scale`   | Passed                | Scaled profile: 10k products/100k observations/500k product-keyword observations; 2,129 ms fixture load, 4 ms latest-product and 4 ms keyword-product bounded windows versus 8s query budget |
| Full research scale baseline | Passed 2026-08-19     | 100k products/1M observations/5M product-keyword observations; 4 ms latest-product and 5 ms keyword-overlap local Docker queries; development baseline only                                  |

The full-scale measurements and methodology are documented in
[Performance](PERFORMANCE.md). The accuracy datasets and synthetic sales
thresholds are documented in [Research evaluation](RESEARCH_EVALUATION.md).

## Known accuracy limits

- Product/category/niche counts describe only the named tracked/imported/project/
  watch/market/history universe.
- Category aggregation is bounded to 1,000 known products per calculation
  window; Product Explorer pages are capped at 100 rows.
- Sparse history preserves gaps. Seasonality and stability confidence falls with
  coverage; neither establishes future demand.
- Opportunity scores are deterministic prioritization aids, not launch outcome
  predictions. Component availability and confidence are part of the result.
- Provider estimates and RizPoint modeled estimates remain distinct. A model is
  unusable outside its calibrated marketplace/category/version.
- Reverse-ASIN gaps and rank share-of-voice use only observed competitors and
  latest valid observations; a missing observation is not a non-ranking fact.
  The Rank Tracker read view caps one server window at 200 tracks and 30 recent
  observations per track and labels share-of-voice as window-scoped.
- Review themes and differentiation recommendations are evidence-bound
  summaries/hypotheses over authorized records, not a complete customer census.
- Compliance output is a screening aid with jurisdiction, source, version, and
  `UNKNOWN`; it does not replace counsel, laboratory evidence, or marketplace
  approval.
- Profitability and portfolio outputs are deterministic for supplied assumptions
  but inherit input uncertainty, FX date, provider fees, demand range, MOQ, and
  scenario limits.
- The Copilot retrieves allowlisted stored evidence. It is not a general
  database agent and does not perform authoritative calculations.

## Production risks

| Priority | Risk                                                                                     | Required mitigation before a production-ready claim                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Blocker  | Unknown live provider coverage, rights, schema drift, quota cost, and retention behavior | Contract review, tenant entitlement records, recorded fixtures, live opt-in smoke tests, cost budgets, and expiry/deletion drills for every enabled provider |
| Blocker  | No real-user/private real-data validation across the seven journeys                      | Run a redacted two-week pilot with named tasks, failure logs, decision replay, support notes, and exit criteria                                              |
| Blocker  | Sales/model accuracy is synthetic only                                                   | Licensed or observed reference set, marketplace/category holdout, backtest error/coverage thresholds, monitoring, and model rollback                         |
| High     | Market and guided launch handoffs remain fragmented                                      | Add contextual project/market selection, prefilled evidence review, complete market timeline/entrant/share surfaces, and browser tests                       |
| High     | Private-owner auth is not commercial role administration                                 | Keep deployment private; implement reviewed roles, admin/deletion, and support boundaries only after explicit Prompt 37 approval                             |
| High     | Provider and scheduled-job behavior lacks production telemetry                           | Capture p50/p95 query/provider latency, queue age, cache outcomes, throttle rate, cost, retry age, stale coverage, and alert evaluator lag                   |
| Medium   | PostgreSQL scale evidence is local                                                       | Re-run representative data on the provisioned production tier, inspect query plans/autovacuum/bloat, and retain the 8-second timeout                         |
| Medium   | AI explanation provider is not configured or model-specifically evaluated                | Keep deterministic retrieval mode until a selected model passes grounding, injection, unsafe-claim, missing-data, latency, and cost evaluations              |
| Medium   | Extension origin/session UX has no signed-in field pilot                                 | Test Chrome install/update, token expiry, backend origin changes, offline behavior, save/watch authorization, and minimum permissions with real users        |

## Recommended 90-day roadmap

### Days 0–30 — prove the private core

1. Select one real private organization, one supported marketplace, and the
   minimum provider set. Record current contracts, entitlements, export rights,
   retention, quotas, and non-secret terms references.
2. Run a redacted wholesale catalog and one private-label niche through all seven
   audited journeys. Log every unavailable field and copied/manual handoff.
3. Complete Market detail/timeline/entrants-exits/share/change-feed views over
   stored data and add project-context handoffs from keyword/niche/listing/launch.
4. Exercise backup/restore, provider credential rotation/revocation, entitlement
   expiry, quota exhaustion, stale-while-refresh, export expiry, and retention in
   a production-like environment.

### Days 31–60 — measure data and decision quality

1. Add only the licensed keyword/rank or history provider needed by the pilot;
   require recorded complete/partial/drift/throttle/unauthorized fixtures first.
2. Build a sufficiently large, licensed/observed sales calibration and holdout
   dataset or leave modeled sales disabled. Publish error, interval coverage,
   category/market scope, and rollback criteria.
3. Measure category/niche membership reconciliation, provider-field coverage,
   stale rates, query p50/p95, queue lag, token/credit cost, alert dedupe, and
   export rights enforcement.
4. Expand Copilot operations only for pilot questions that map to deterministic
   services and evidence IDs; keep model output optional.

### Days 61–90 — close private release criteria

1. Run the two-week real-user pilot with scripted wholesale, discovery, keyword,
   market, launch, extension, and Copilot tasks. Track wrong decisions and
   unsupported conclusions, not only crashes.
2. Resolve accessibility/responsive findings with desktop, tablet, mobile, and
   keyboard/browser evidence. Repeat security, integration, research, and scale
   gates on the release candidate.
3. Establish operational dashboards, on-call/recovery ownership, provider spend
   caps, accuracy drift alerts, and a documented go/no-go review.
4. Decide whether to request optional Prompt 37 only after the private tool is
   reliable on live data. Prompt 36 does not authorize SaaS conversion.

## Release conclusion

The repository passes the architectural threshold for an evidence-first private
research OS candidate: the workflows share a trustworthy core, calculations are
versioned and testable, mock/live states are explicit, and external-data rights
can be enforced. It does not pass a production-readiness threshold until live
provider contracts/data, real-user journeys, sales accuracy, operations, and
production-tier performance are validated. No market-size, exact-sales,
certification-clearance, or global-database claim should be made from the
current system.
