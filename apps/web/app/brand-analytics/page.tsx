import { Alert, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
export default function BrandAnalyticsPage() {
  return (
    <main className="content-page">
      <PageHeader
        title="First-party Amazon analytics"
        description="Official SQP/Brand Analytics evidence where the connected account and brand are eligible."
        breadcrumbs={[
          { label: "Keyword Explorer", href: "/keyword-explorer" },
          { label: "First-party Amazon" },
        ]}
      />
      <Alert tone="warning" title="No eligible first-party connection">
        No authorized Brand Analytics/SQP report capability is configured.
        Search-volume estimates and first-party metrics remain separate and are
        not compared across incompatible date windows.
      </Alert>
      <Card>
        <h2>Official report boundary</h2>
        <p>
          Eligible accounts can request asynchronous, date-bounded official
          reports through the BrandAnalyticsProvider. Click/conversion/purchase
          share remains unsupported until the official response supplies it.
        </p>
      </Card>
    </main>
  );
}
