import { Alert, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
export default function RankTrackerPage() {
  return (
    <main className="content-page">
      <PageHeader
        title="Keyword rank tracker"
        description="Scheduled organic and sponsored rank monitoring through authorized SearchRankProvider observations."
        breadcrumbs={[
          { label: "Keyword Explorer", href: "/keyword-explorer" },
          { label: "Rank tracker" },
        ]}
      />
      <Alert tone="warning" title="No SearchRankProvider configured">
        No tracking jobs are scheduled. Existing observations are retained if
        quotas are exhausted; unavailable provider responses never overwrite
        history.
      </Alert>
      <Card>
        <h2>Tracking cadence and share of voice</h2>
        <p>
          Tracks are idempotent by tracker/request key, support daily or weekly
          cadence, and retain multiple ASINs per keyword. Trend, moving average,
          volatility, and share-of-voice are calculated from stored observations
          only.
        </p>
      </Card>
    </main>
  );
}
