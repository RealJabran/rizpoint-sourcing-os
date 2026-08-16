"use client";

type Point = Record<string, unknown>;
type Series = Record<string, unknown>;
type Assessment = Record<string, unknown>;

function label(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function value(point: Point): string {
  const raw =
    point.decimalValue ??
    point.integerValue ??
    point.booleanValue ??
    point.textValue;
  return raw === undefined || raw === null ? "Not available" : String(raw);
}

function coverage(metric: Record<string, unknown> | undefined): string {
  const item = metric?.coverage;
  if (!item || typeof item !== "object") return "Coverage unavailable";
  const details = item as Record<string, unknown>;
  return `${String(details.ratioPercent ?? "—")}% coverage · ${String(details.observations ?? "—")} observations · ${String(details.confidence ?? "UNKNOWN").toLocaleLowerCase("en-US")} confidence`;
}

function MetricCell({
  title,
  metric,
  fields,
}: {
  title: string;
  metric: Record<string, unknown> | undefined;
  fields: readonly [string, string][];
}) {
  const status = String(metric?.status ?? "INSUFFICIENT_DATA");
  return (
    <section
      className="history-metric-card"
      aria-label={`${title} historical metric`}
    >
      <div className="history-metric-heading">
        <h4>{title}</h4>
        <span className={`status-badge status-${status.toLowerCase()}`}>
          {label(status)}
        </span>
      </div>
      <p className="history-coverage">{coverage(metric)}</p>
      <dl className="history-metric-values">
        {fields.map(([key, caption]) => (
          <div key={key}>
            <dt>{caption}</dt>
            <dd>
              {metric?.[key] === undefined
                ? "Not available"
                : String(metric[key])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A read-only chart: it presents raw persisted points and does not calculate
 * financial or research outputs in the browser. */
export function HistoryPointList({ series }: { series: Series }) {
  const points = Array.isArray(series.points) ? (series.points as Point[]) : [];
  return (
    <section className="history-raw-series">
      <h4>{label(String(series.metricKey ?? "history"))} raw observations</h4>
      <p>
        Source: {String(series.providerKey ?? "unknown")} · unit:{" "}
        {String(series.unit ?? "unknown")}
        {series.currency ? ` · ${String(series.currency)}` : ""}
      </p>
      {points.length ? (
        <div
          className="history-points-scroll"
          tabIndex={0}
          aria-label={`${String(series.metricKey)} raw history observations`}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Observed metric time</th>
                <th scope="col">Value</th>
                <th scope="col">Provider observation</th>
                <th scope="col">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => {
                const source = point.sourceObservation as Point | undefined;
                return (
                  <tr key={`${String(point.metricAt)}-${index}`}>
                    <td>{String(point.metricAt ?? "Unknown")}</td>
                    <td>{value(point)}</td>
                    <td>{String(source?.observedAt ?? "Unknown")}</td>
                    <td>{String(source?.freshnessState ?? "UNKNOWN")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No raw observations are retained for this series.</p>
      )}
    </section>
  );
}

function HistoryAnalyticsSummary({ assessment }: { assessment: Assessment }) {
  const metrics = assessment.metrics as Record<string, unknown> | undefined;
  if (!metrics || typeof metrics !== "object")
    return <p>Derived history analytics have not been calculated yet.</p>;
  const price = metrics.price as
    Record<string, Record<string, unknown>> | undefined;
  const rank = metrics.salesRank as
    Record<string, Record<string, unknown>> | undefined;
  const offers = metrics.offerCount as
    Record<string, Record<string, unknown>> | undefined;
  const retail = metrics.amazonRetailPresence as
    Record<string, Record<string, unknown>> | undefined;
  const reviews = metrics.reviewCountGrowth as
    Record<string, Record<string, unknown>> | undefined;
  const seasonal = metrics.seasonalIndex as Record<string, unknown> | undefined;
  return (
    <section
      className="history-derived"
      aria-label="Derived historical analytics"
    >
      <div className="history-metric-heading">
        <h3>Derived historical analytics</h3>
        <span
          className={`status-badge status-${String(assessment.status ?? "INSUFFICIENT_DATA").toLowerCase()}`}
        >
          {label(String(assessment.status ?? "INSUFFICIENT_DATA"))}
        </span>
      </div>
      <p>
        Calculation: {String(assessment.calculationVersion ?? "unknown")} ·
        provider: {String(assessment.providerKey ?? "unknown")} · calculated{" "}
        {String(assessment.calculatedAt ?? "unknown")} · analysis window ending{" "}
        {String(assessment.windowEnd ?? "unknown")}
      </p>
      <p>
        Price source:{" "}
        {label(String(metrics.priceSourceMetricKey ?? "not available"))}.
        Historical metrics are descriptive evidence, not sales estimates or
        guaranteed future prices.
      </p>
      <div className="history-metric-grid">
        <MetricCell
          title="30-day price"
          metric={price?.["30"]}
          fields={[
            ["median", "Median"],
            ["mean", "Mean"],
            ["conservativePercentile20", "Conservative 20th percentile"],
            ["volatilityPercent", "Volatility %"],
            ["maxDrawdownPercent", "Max drawdown %"],
          ]}
        />
        <MetricCell
          title="90-day BSR"
          metric={rank?.["90"]}
          fields={[
            ["median", "Median rank"],
            ["trendSlopePerDay", "Trend slope / day"],
            ["volatilityPercent", "Volatility %"],
          ]}
        />
        <MetricCell
          title="90-day visible offers"
          metric={offers?.["90"]}
          fields={[
            ["median", "Median offers"],
            ["trendSlopePerDay", "Trend slope / day"],
          ]}
        />
        <MetricCell
          title="90-day Amazon availability"
          metric={retail?.["90"]}
          fields={[["presentPercent", "Observed present %"]]}
        />
        <MetricCell
          title="90-day review count"
          metric={reviews?.["90"]}
          fields={[
            ["growth", "Observed growth"],
            ["trendSlopePerDay", "Trend slope / day"],
          ]}
        />
        <MetricCell
          title="Seasonality"
          metric={seasonal}
          fields={[["indexPercent", "Seasonal index %"]]}
        />
      </div>
      <dl className="history-metric-values">
        <div>
          <dt>Estimated listing age</dt>
          <dd>
            {metrics.estimatedListingAgeDays
              ? `${String(metrics.estimatedListingAgeDays)} days from provider first-observed fact`
              : "Insufficient provider data"}
          </dd>
        </div>
        <div>
          <dt>First observed</dt>
          <dd>{String(metrics.firstObservedAt ?? "Not available")}</dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>
            {Array.isArray(metrics.warnings) && metrics.warnings.length
              ? metrics.warnings
                  .map((warning) => label(String(warning)))
                  .join(", ")
              : "None from observed data"}
          </dd>
        </div>
      </dl>
      {seasonal?.explanation ? (
        <p className="history-coverage">{String(seasonal.explanation)}</p>
      ) : null}
    </section>
  );
}

export function HistoryPanel({
  historyEvidence,
  historyAnalytics,
}: {
  historyEvidence: unknown;
  historyAnalytics: unknown;
}) {
  const series = Array.isArray(historyEvidence)
    ? (historyEvidence as Series[])
    : [];
  const analytics = Array.isArray(historyAnalytics)
    ? (historyAnalytics as Assessment[])
    : [];
  return (
    <div
      className="history-panel"
      role="tabpanel"
      id="history-evidence-panel"
      aria-labelledby="history-evidence-tab"
    >
      <h3>History</h3>
      <p>
        Raw provider observations and derived metrics are shown separately.
        Missing observations are not replaced with zeroes, and this optional
        evidence does not change the current wholesale calculation.
      </p>
      {analytics.length ? (
        <HistoryAnalyticsSummary assessment={analytics[0]!} />
      ) : (
        <p>
          Derived historical analytics are unavailable until a history refresh
          returns enough licensed provider data.
        </p>
      )}
      <h3>Raw history</h3>
      {series.length ? (
        series.map((entry, index) => (
          <HistoryPointList
            key={`${String(entry.metricKey)}-${index}`}
            series={entry}
          />
        ))
      ) : (
        <p>No licensed market history is stored for this product.</p>
      )}
    </div>
  );
}
