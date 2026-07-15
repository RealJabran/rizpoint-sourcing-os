import { PageHeader } from "@/src/components/page-header";
import { ButtonLink, Card } from "@/src/components/ui";

export default function PurchaseOrdersLandingPage() {
  return (
    <main className="content-page placeholder-page">
      <PageHeader
        title="Purchase orders"
        description="Purchase orders are created from shortlist items with a verified scenario and route."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Purchase orders" },
        ]}
      />
      <Card className="empty-state">
        <span className="empty-state__eyebrow">Available from a shortlist</span>
        <h2>Start with selected sourcing decisions.</h2>
        <p>
          The purchase-order index is not implemented yet. Existing purchase
          orders remain available from their direct record links.
        </p>
        <ButtonLink href="/shortlists">Open shortlists</ButtonLink>
      </Card>
    </main>
  );
}
