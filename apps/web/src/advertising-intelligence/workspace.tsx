"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Capability = {
  providerKey: string;
  marketplaceId: string;
  state: string;
  completeness: string;
  reason?: string;
};

export function AdvertisingIntelligence() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  useEffect(() => {
    void fetch("/api/advertising-intelligence")
      .then((response) =>
        response.ok ? response.json() : { capabilities: [] },
      )
      .then((body: { capabilities: Capability[] }) =>
        setCapabilities(body.capabilities),
      );
  }, []);
  return (
    <main className="content-page">
      <PageHeader
        title="Advertising Intelligence"
        description="Licensed sponsored-search visibility only."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Advertising intelligence" },
        ]}
      />
      <Alert tone="warning" title="No advertising data is fabricated">
        RizPoint does not inspect Amazon HTML for sponsored placements.
        Keyword/ASIN ad visibility, overlap, paid-density, share-of-voice, and
        CPC reports activate only after an entitled licensed provider or
        authorized first-party connection supplies observations.
      </Alert>
      <Card>
        {capabilities.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Marketplace</th>
                  <th>State</th>
                  <th>Completeness</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {capabilities.map((item) => (
                  <tr key={`${item.providerKey}-${item.marketplaceId}`}>
                    <td>{item.providerKey}</td>
                    <td>{item.marketplaceId}</td>
                    <td>
                      <Badge tone="warning">{item.state}</Badge>
                    </td>
                    <td>{item.completeness}</td>
                    <td>{item.reason ?? "No current observation"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            Configure a provider entitlement with the AD_INTELLIGENCE capability
            to enable sponsored visibility research. No mock advertising
            observations are shown as live data.
          </p>
        )}
      </Card>
    </main>
  );
}
