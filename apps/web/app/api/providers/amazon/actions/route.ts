import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AmazonConnectionError,
  getAmazonIntegrationStatus,
  requestAmazonConnectionJob,
  setDefaultAmazonMarketplace,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("TEST_CONNECTION") }),
  z.object({ action: z.literal("REFRESH_CAPABILITIES") }),
  z.object({
    action: z.literal("SET_DEFAULT_MARKETPLACE"),
    marketplaceId: z.string().min(1).max(64),
  }),
]);

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const organization = await organizationForRequest(request);
  const connection = await getAmazonIntegrationStatus(organization.id);
  if (!connection)
    return NextResponse.json(
      { error: "CONNECTION_NOT_FOUND" },
      { status: 404 },
    );
  try {
    if (parsed.data.action === "SET_DEFAULT_MARKETPLACE") {
      await setDefaultAmazonMarketplace({
        organizationId: organization.id,
        connectionId: connection.id,
        marketplaceId: parsed.data.marketplaceId,
      });
      return NextResponse.json({ status: "UPDATED" });
    }
    const job = await requestAmazonConnectionJob({
      organizationId: organization.id,
      connectionId: connection.id,
      kind:
        parsed.data.action === "TEST_CONNECTION"
          ? "VALIDATE"
          : "REFRESH_CAPABILITIES",
    });
    return NextResponse.json({ status: "QUEUED", action: job.kind });
  } catch (error) {
    const code =
      error instanceof AmazonConnectionError ? error.code : "ACTION_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
