import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  researchRepository,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { productExplorerActionSchema } from "@/src/product-explorer/contracts";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = productExplorerActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_PRODUCT_EXPLORER_ACTION" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  try {
    if (parsed.data.action === "SAVE_TO_PROJECT") {
      const project = await researchRepository.getProject(
        organization.id,
        parsed.data.projectId,
      );
      if (!project)
        return NextResponse.json(
          { error: "RESEARCH_PROJECT_NOT_FOUND" },
          { status: 404 },
        );
      await Promise.all(
        parsed.data.productIds.map((catalogProductId) =>
          researchRepository.addProjectItem({
            organizationId: organization.id,
            projectId: project.id,
            kind: "PRODUCT",
            catalogProductId,
            subjectKey: catalogProductId,
          }),
        ),
      );
    } else {
      const watch = parsed.data;
      await Promise.all(
        watch.productIds.map((catalogProductId) =>
          researchRepository.createProductWatch({
            organizationId: organization.id,
            catalogProductId,
            marketplaceId: watch.marketplaceId,
            ...(watch.projectId ? { projectId: watch.projectId } : {}),
          }),
        ),
      );
    }
    return NextResponse.json({
      status: "OK",
      count: parsed.data.productIds.length,
    });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "PRODUCT_EXPLORER_ACTION_FAILED";
    return NextResponse.json({ error: code }, { status: 409 });
  }
}
