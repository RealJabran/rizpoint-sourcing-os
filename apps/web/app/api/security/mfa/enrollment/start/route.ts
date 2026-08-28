import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { startMfaEnrollment } from "@/src/security/authentication";

export const runtime = "nodejs";

const inputSchema = z.object({ challengeToken: z.string().min(32).max(256) });

export async function POST(request: NextRequest) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "ENROLLMENT_INVALID" }, { status: 400 });
  try {
    const enrollment = await startMfaEnrollment(input.data.challengeToken);
    const qrDataUrl = await QRCode.toDataURL(enrollment.enrollmentUri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    });
    return NextResponse.json(
      { manualKey: enrollment.secret, qrDataUrl },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "ENROLLMENT_INVALID" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
}
