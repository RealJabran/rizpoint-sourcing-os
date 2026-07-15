import { PageHeader } from "@/src/components/page-header";
import { Badge, Card } from "@/src/components/ui";

export default function LearningPage() {
  return (
    <main className="content-page placeholder-page">
      <PageHeader
        title="Learning & help"
        description="Product guidance will be added without changing your sourcing records."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Learning & help" },
        ]}
      />
      <Card className="empty-state">
        <Badge tone="neutral">Coming soon</Badge>
        <h2>Guided sourcing help is planned.</h2>
        <p>
          For now, use the workflow labels and evidence shown within each
          catalog scan. Authentication and administration remain separate Phase
          8 work.
        </p>
      </Card>
    </main>
  );
}
