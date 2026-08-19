import { NextResponse } from "next/server";
import { MARKETPLACES } from "@rizpoint/database";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({
    marketplaces: MARKETPLACES,
    notice:
      "Capabilities are marketplace-specific. Cross-market metrics require explicit currency/definition normalization.",
  });
}
