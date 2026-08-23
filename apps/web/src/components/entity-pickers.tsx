"use client";

import { useEffect, useState, type SelectHTMLAttributes } from "react";
import { SelectControl } from "./ui";

type PickerProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  emptyLabel?: string;
};

type ProductOption = {
  id: string;
  title: string;
  asin: string | null;
  brand: string | null;
};

type ProjectOption = {
  id: string;
  name: string;
  status: string;
};

type MarketplaceOption = {
  id: string;
  label?: string;
  domain: string;
  currency: string;
};

export function ProductPicker({
  emptyLabel = "Choose a researched product",
  ...props
}: PickerProps) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/product-explorer?limit=100", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setProducts(payload?.rows ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <SelectControl {...props}>
      <option value="">{emptyLabel}</option>
      {products.map((product) => (
        <option key={product.id} value={product.id}>
          {product.title} · {product.asin ?? product.brand ?? "Stored evidence"}
        </option>
      ))}
    </SelectControl>
  );
}

export function ProjectPicker({
  emptyLabel = "Choose a research project",
  ...props
}: PickerProps) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/research-projects", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => setProjects(payload))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <SelectControl {...props}>
      <option value="">{emptyLabel}</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name} · {project.status.toLowerCase()}
        </option>
      ))}
    </SelectControl>
  );
}

export function MarketplacePicker({
  emptyLabel = "All connected marketplaces",
  ...props
}: PickerProps) {
  const [marketplaces, setMarketplaces] = useState<MarketplaceOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/marketplaces", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setMarketplaces(payload?.marketplaces ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <SelectControl {...props}>
      <option value="">{emptyLabel}</option>
      {marketplaces.map((marketplace) => (
        <option key={marketplace.id} value={marketplace.id}>
          {marketplace.label ?? marketplace.domain} · {marketplace.currency}
        </option>
      ))}
    </SelectControl>
  );
}
