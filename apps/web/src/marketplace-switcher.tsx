"use client";

import { useEffect, useState } from "react";

type Marketplace = {
  id: string;
  domain: string;
  currency: string;
  locale: string;
  capabilities: string[];
};
const fallback: Marketplace[] = [
  {
    id: "ATVPDKIKX0DER",
    domain: "amazon.com",
    currency: "USD",
    locale: "en-US",
    capabilities: [],
  },
];

export function MarketplaceSwitcher() {
  const [value, setValue] = useState("ATVPDKIKX0DER");
  const [marketplaces, setMarketplaces] = useState(fallback);
  useEffect(() => {
    void Promise.resolve().then(() =>
      setValue(
        localStorage.getItem("rizpoint.defaultMarketplace") ?? "ATVPDKIKX0DER",
      ),
    );
    void fetch("/api/marketplaces")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.marketplaces?.length)
          setMarketplaces(payload.marketplaces);
      });
  }, []);
  return (
    <label>
      Marketplace
      <select
        className="rp-select"
        aria-label="Default research marketplace"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          localStorage.setItem("rizpoint.defaultMarketplace", next);
          window.dispatchEvent(
            new CustomEvent("rizpoint:marketplace-change", {
              detail: { marketplaceId: next },
            }),
          );
        }}
      >
        {marketplaces.map((marketplace) => (
          <option key={marketplace.id} value={marketplace.id}>
            {marketplace.domain} · {marketplace.currency}
            {marketplace.capabilities.length <= 1 ? " · limited" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
