"use client";
import { useEffect, useState } from "react";
import { Alert, Card } from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
type Brand = {
  brand: string;
  productCount: number;
  medianPrice: string | null;
  universe: string;
};
export function BrandIntelligence() {
  const [brands, setBrands] = useState<Brand[]>([]);
  useEffect(() => {
    void fetch("/api/brand-intelligence")
      .then((r) => (r.ok ? r.json() : []))
      .then(setBrands);
  }, []);
  return (
    <main className="content-page">
      <PageHeader
        title="Brand Intelligence"
        description="Competitive brand research from sourced, known products."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Brand Intelligence" },
        ]}
      />
      <Alert tone="info" title="Coverage and identity">
        Counts are limited to the organization’s known universe. A brand label
        is catalog/provider evidence; seller names are never treated as brand
        ownership.
      </Alert>
      <Card>
        {brands.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Known ASINs</th>
                  <th>Median observed price</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => (
                  <tr key={brand.brand}>
                    <td>{brand.brand}</td>
                    <td>{brand.productCount}</td>
                    <td>{brand.medianPrice ?? "Unavailable"}</td>
                    <td>{brand.universe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No brand evidence is available. Import or track products to build a
            sourced known-brand universe.
          </p>
        )}
      </Card>
    </main>
  );
}
