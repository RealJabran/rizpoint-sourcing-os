"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Seller = {
  sellerReference: string;
  displayName: string | null;
  knownProductCount: string | null;
  amazonRetailPresence: "PRESENT" | "ABSENT" | "UNKNOWN";
  providerKey: string;
  observedAt: string;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
};

export function SellerIntelligence() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  useEffect(() => {
    void fetch("/api/seller-intelligence")
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .then((body: { rows: Seller[] }) => setSellers(body.rows));
  }, []);

  return (
    <main className="content-page">
      <PageHeader
        title="Seller & Competitor Intelligence"
        description="Licensed seller observations, kept separate from product research."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Seller intelligence" },
        ]}
      />
      <Alert tone="info" title="Authorized evidence only">
        Seller search, product overlap, brand relationships, and economic
        estimates appear only when an entitled provider supplies them. RizPoint
        does not scrape seller storefronts or enrich personal data.
      </Alert>
      <Card>
        {sellers.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Known products</th>
                  <th>Retail presence</th>
                  <th>Source</th>
                  <th>Observed</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => (
                  <tr key={seller.sellerReference}>
                    <td>{seller.displayName ?? seller.sellerReference}</td>
                    <td>{seller.knownProductCount ?? "Unavailable"}</td>
                    <td>{seller.amazonRetailPresence}</td>
                    <td>
                      <Badge
                        tone={
                          seller.completeness === "COMPLETE"
                            ? "success"
                            : "warning"
                        }
                      >
                        {seller.providerKey} · {seller.completeness}
                      </Badge>
                    </td>
                    <td>{new Date(seller.observedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No entitled seller evidence is stored. Configure a licensed Seller
            Intelligence provider to research competitors; product research
            remains available without it.
          </p>
        )}
      </Card>
    </main>
  );
}
