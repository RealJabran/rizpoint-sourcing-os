import { ProductDetailWorkspace } from "@/src/product-research/detail-workspace";

export default async function ProductResearchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  return (
    <ProductDetailWorkspace
      runId={runId}
      {...(query.product ? { initialProductId: query.product } : {})}
    />
  );
}
