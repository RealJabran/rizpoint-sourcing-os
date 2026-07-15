import { PageHeader } from "@/src/components/page-header";
import { ButtonLink, Card } from "@/src/components/ui";

export default function AnalysisLandingPage() {
  return (
    <main className="content-page placeholder-page">
      <PageHeader
        title="Analysis workspace"
        description="Analysis is always scoped to a specific completed catalog scan."
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Analysis" }]}
      />
      <Card className="empty-state">
        <span className="empty-state__eyebrow">Choose a completed scan</span>
        <h2>Results are never mixed across catalog scans.</h2>
        <p>
          Open a completed scan from the scan list to review its matching
          evidence, data freshness, and deterministic profitability scenarios.
        </p>
        <ButtonLink href="/scans">View scan list</ButtonLink>
      </Card>
    </main>
  );
}
