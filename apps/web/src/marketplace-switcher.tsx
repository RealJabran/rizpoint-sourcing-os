"use client";
import { useEffect, useState } from "react";
export function MarketplaceSwitcher() {
  const [value, setValue] = useState("ATVPDKIKX0DER");
  useEffect(
    () =>
      setValue(
        localStorage.getItem("rizpoint.defaultMarketplace") ?? "ATVPDKIKX0DER",
      ),
    [],
  );
  return (
    <label>
      Marketplace
      <select
        className="rp-select"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          localStorage.setItem("rizpoint.defaultMarketplace", e.target.value);
        }}
      >
        <option value="ATVPDKIKX0DER">Amazon.com · USD</option>
        <option value="A1F83G8C2ARO7P">Amazon.co.uk · GBP</option>
        <option value="A1PA6795UKMFR9">Amazon.de · EUR</option>
        <option value="A2EUQ1WTGCTBG2">Amazon.ca · CAD</option>
      </select>
    </label>
  );
}
