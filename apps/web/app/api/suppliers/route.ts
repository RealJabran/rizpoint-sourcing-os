import { NextRequest, NextResponse } from "next/server";
import {
  createSupplier,
  ensurePhaseZeroOrganization,
  listSuppliers,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { supplierInputSchema } from "@/src/phase-one";

export const runtime = "nodejs";

export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(await listSuppliers(organization.id));
}

export async function POST(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = supplierInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_SUPPLIER" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await createSupplier(organization.id, parsed.data.code, parsed.data.name),
    { status: 201 },
  );
}
