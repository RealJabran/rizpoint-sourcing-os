"use client";

import { useEffect, useState } from "react";

type Marketplace = {
  id: string;
  domain: string;
  currency: string;
  locale: string;
  capabilities: string[];
  isDefault?: boolean;
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
  const [connectedSource, setConnectedSource] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() =>
      setValue(
        localStorage.getItem("rizpoint.defaultMarketplace") ?? "ATVPDKIKX0DER",
      ),
    );
    void fetch("/api/marketplaces")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.marketplaces?.length) {
          setMarketplaces(payload.marketplaces);
          setConnectedSource(
            payload.source === "AMAZON_MARKETPLACE_PARTICIPATIONS",
          );
          const selected = payload.marketplaces.find(
            (marketplace: Marketplace) => marketplace.isDefault,
          );
          if (selected) {
            setValue(selected.id);
            localStorage.setItem("rizpoint.defaultMarketplace", selected.id);
          }
        }
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
          if (connectedSource)
            void fetch("/api/providers/amazon/actions", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "SET_DEFAULT_MARKETPLACE",
                marketplaceId: next,
              }),
            });
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
