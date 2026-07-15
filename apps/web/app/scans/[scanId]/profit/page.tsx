import { redirect } from "next/navigation";

/** The analysis workspace renders typed evidence instead of raw JSON. */
export default async function ProfitPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  redirect(`/scans/${(await params).scanId}/analysis`);
}
