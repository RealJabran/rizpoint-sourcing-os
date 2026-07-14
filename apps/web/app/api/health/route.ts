import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "web",
    release: process.env.RIZPOINT_RELEASE_SHA ?? "development",
  });
}
