import { NextResponse } from "next/server";
import { db } from "@rizpoint/database";
import { storageReady } from "@rizpoint/object-storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const scanner = await fetch(
      `${process.env.SCANNER_BASE_URL ?? "http://127.0.0.1:8000"}/ready`,
      { signal: AbortSignal.timeout(1_000) },
    );
    const [storage] = await Promise.all([
      storageReady(),
      db.$queryRaw`SELECT 1`,
    ]);
    if (!storage || !scanner.ok) throw new Error("dependency_not_ready");
    return NextResponse.json({ status: "ready", service: "web" });
  } catch {
    return NextResponse.json(
      { status: "not_ready", service: "web" },
      { status: 503 },
    );
  }
}
