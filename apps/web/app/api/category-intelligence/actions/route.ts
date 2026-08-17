import { NextRequest, NextResponse } from "next/server";
import {
  createResearchRepository,
  ensurePhaseZeroOrganization,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { categoryActionSchema } from "@/src/category-intelligence/contracts";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = categoryActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_CATEGORY_ACTION" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const repository = createResearchRepository();
  try {
    if (parsed.data.action === "SAVE_TO_PROJECT") {
      const project = await repository.getProject(
        organization.id,
        parsed.data.projectId,
      );
      if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
      if (project.marketplaceId !== parsed.data.marketplaceId)
        throw new Error("MARKETPLACE_MISMATCH");
      const item = await repository.addProjectItem({
        organizationId: organization.id,
        projectId: parsed.data.projectId,
        kind: "CATEGORY",
        subjectKey: parsed.data.categoryReference,
        displayLabel: parsed.data.categoryName,
      });
      return NextResponse.json(item);
    }
    const watch = await repository.createCategoryWatch({
      organizationId: organization.id,
      ...parsed.data,
    });
    return NextResponse.json(watch);
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "CATEGORY_ACTION_FAILED";
    return NextResponse.json(
      { error: code },
      { status: code === "RESEARCH_PROJECT_NOT_FOUND" ? 404 : 400 },
    );
  }
}
