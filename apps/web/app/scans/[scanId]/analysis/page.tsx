import { AnalysisWorkspace } from "@/src/analysis/workspace";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  return <AnalysisWorkspace scanId={(await params).scanId} />;
}
