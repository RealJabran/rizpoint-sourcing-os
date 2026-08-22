import { PageHeader } from "@/src/components/page-header";
import { Badge, ButtonLink, Card } from "@/src/components/ui";

export default function IntegrationsPage() {
  return (
    <main className="content-page integrations-page">
      <PageHeader
        title="Integrations"
        description="Manage licensed data providers and see exactly which sources are active for this organization."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Settings" },
          { label: "Integrations" },
        ]}
      />
      <Card className="integration-directory-card">
        <div className="amazon-provider-mark" aria-hidden="true">
          a
        </div>
        <div>
          <div className="badge-stack">
            <Badge tone="info">Amazon</Badge>
            <Badge tone="neutral">Organization connection</Badge>
          </div>
          <h2>Amazon Selling Partner API</h2>
          <p>
            Connect Seller Central, discover accessible marketplaces, and
            validate catalog, pricing, fees, and restriction capabilities.
          </p>
        </div>
        <ButtonLink href="/settings/integrations/amazon">
          Manage Amazon
        </ButtonLink>
      </Card>
    </main>
  );
}
