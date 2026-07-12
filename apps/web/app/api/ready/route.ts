import { NextResponse } from "next/server";
import { db } from "@rizpoint/database";

export const runtime = "nodejs";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready", service: "web" });
  } catch {
    return NextResponse.json(
      { status: "not_ready", service: "web" },
      { status: 503 },
    );
  }
}
