# Research accuracy evaluation

Prompt 35 introduces `research-accuracy-benchmark/v1`, a formal release gate
for deterministic research metrics, evidence-grounded AI output, and provider
contract behavior.

## Run the gate

```bash
pnpm release-gate:research
```

The command builds the evaluation package and all production dependencies,
lints and typechecks the harness, runs its tests, and prints a machine-readable
JSON report. Any failed case or sales-quality threshold exits non-zero. CI runs
the same command in the native job.

## Golden datasets

All fixtures are checked-in JSON under
`packages/research-evals/src/fixtures/`. They contain only synthetic or
recorded/redacted values and no credentials, supplier files, customers, or raw
licensed payloads.

| Dataset             | Coverage                                                                                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metrics.v1.json`   | Product history, seasonality, opportunity scoring, niche and category aggregation, keyword normalization, reverse-ASIN gaps, rank tracking/share of voice, sales estimation/backtesting, review clustering, differentiation, wholesale and private-label profitability, compliance, and portfolio optimization |
| `ai.v1.json`        | Evidence citations, unsupported facts, missing-data disclosure, unsafe claims, and imported prompt-injection text                                                                                                                                                                                              |
| `providers.v1.json` | Complete and partial recorded responses, schema drift, throttling/retry timing, normalized contract rejection, fee-component drift, and missing entitlement rights                                                                                                                                             |

The runner calls production functions directly. Golden expected values select
the contract-critical output fields; they do not duplicate the formula in test
code.

## Formula change policy

Every evaluated metric family has an explicit version in production and the
golden formula registry. A formula or semantic change requires all of:

1. bump the production version constant;
2. add or update a golden case with independently reviewed expected output;
3. update the formula registry and relevant domain documentation;
4. explain compatibility or historical replay impact in the change review.

Changing a calculation without updating its pinned expected output fails the
gate. Changing only a version without updating the registry also fails. Pure
refactors that provably preserve outputs do not require a version bump.

## Sales-estimation quality

The synthetic reference cases report:

- sample size;
- mean absolute error (MAE);
- mean absolute percentage error (MAPE), excluding zero actuals from the MAPE
  denominator only;
- low/high interval coverage.

The v1 fixture gate requires MAE at most `10.00`, MAPE at most `15.00%`, and
interval coverage at least `100.00%` for its three deliberately small audit
cases. These thresholds prove the evaluation machinery and formula behavior;
they do **not** establish real-market predictive quality. A live calibrated
model must carry a licensed/observed reference dataset, category and marketplace
scope, materially larger holdout coverage, and reviewed thresholds before it
can be enabled.

## AI grounding contract

Evaluation answers are structured as claims. `FACT` and `DERIVED` claims need
at least one known evidence ID and must match a claim that evidence permits.
`HYPOTHESIS` remains visibly non-factual but still fails for authoritative
medical, guaranteed-clearance, or IP-safety language. Required missing inputs
must appear in the answer's missing-data list. The golden suite intentionally
contains hallucinated, uncited, concealed-missing-data, unsafe-claim, and
prompt-injection cases; the release case passes only when the evaluator rejects
them for the expected reason.

This is a deterministic pre-deployment control, not a substitute for human
review or model-specific adversarial evaluation. No live generative provider is
configured by this benchmark.

## Provider contract policy

Recorded fixtures are passed through production Keepa normalization, SP-API
fee normalization, provider schemas, and data-rights evaluation. Schema drift
must become partial/invalid state, throttles must preserve retry timing, and
missing entitlements must fail closed. Adding a live adapter requires cases for
its complete shape, partial payload, drift, throttle/quota response, and
authorization/entitlement failure before capability enablement.
