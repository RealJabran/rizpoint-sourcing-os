"use client";
import { useEffect, useState } from "react";
import { Alert, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Market = {
  id: string;
  name: string;
  marketplaceId: string;
  membershipMode: string;
  memberCount: number;
  latestObservedAt: string | null;
  estimatedRevenue: string | null;
  coverage: string;
};
export function MarketTracker() {
  const [markets, setMarkets] = useState<Market[]>([]);
  useEffect(() => {
    void fetch("/api/market-tracker")
      .then((r) => (r.ok ? r.json() : []))
      .then(setMarkets);
  }, []);
  return (
    <main className="content-page">
      <PageHeader
        title="Market Tracker"
        description="Persistent market monitoring with explicit membership and compatible observation windows."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Market Tracker" },
        ]}
      />
      <Alert tone="info" title="Membership and windows are explicit">
        Frozen and dynamic markets are displayed separately. Entrants/exits use
        MarketMember joined/left timestamps; unavailable provider metrics remain
        unavailable.
      </Alert>
      <Card>
        {markets.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Mode</th>
                  <th>Members</th>
                  <th>Latest window</th>
                  <th>Revenue</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((market) => (
                  <tr key={market.id}>
                    <td>
                      {market.name}
                      <small>{market.marketplaceId}</small>
                    </td>
                    <td>{market.membershipMode}</td>
                    <td>{market.memberCount}</td>
                    <td>{market.latestObservedAt ?? "No snapshot"}</td>
                    <td>{market.estimatedRevenue ?? "Unavailable"}</td>
                    <td>{market.coverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No tracked markets. Create a versioned MarketDefinition from a
            category, keyword, or product set.
          </p>
        )}
      </Card>
    </main>
  );
}
