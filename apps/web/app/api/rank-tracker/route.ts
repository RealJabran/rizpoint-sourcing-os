import { NextRequest, NextResponse } from "next/server";
import {
  calculateKeywordRankAnalytics,
  ensurePhaseZeroOrganization,
  listKeywordRankTracks,
  listProviderCapabilityStates,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

function boundedInteger(
  value: string | null,
  fallback: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(0, parsed))
    : fallback;
}

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  const [trackWindow, capabilityStates] = await Promise.all([
    listKeywordRankTracks({
      organizationId: organization.id,
      offset: boundedInteger(
        request.nextUrl.searchParams.get("offset"),
        0,
        1_000_000,
      ),
      limit:
        boundedInteger(request.nextUrl.searchParams.get("limit"), 100, 200) ||
        100,
    }),
    listProviderCapabilityStates({ organizationId: organization.id }),
  ]);
  const tracks = trackWindow.rows;
  const groups = new Map<string, typeof tracks>();
  for (const track of tracks)
    groups.set(track.keywordId, [
      ...(groups.get(track.keywordId) ?? []),
      track,
    ]);

  return NextResponse.json({
    total: trackWindow.total,
    offset: trackWindow.offset,
    limit: trackWindow.limit,
    universe:
      "Stored KeywordRankTrack records in this bounded organization window; share-of-voice is calculated only across the tracks returned in this window.",
    capabilityStates: capabilityStates.filter(
      (state) => state.capability === "SEARCH_RANK",
    ),
    groups: [...groups.values()].map((keywordTracks) => {
      const first = keywordTracks[0]!;
      const analytics = calculateKeywordRankAnalytics(
        keywordTracks.flatMap((track) =>
          track.observations.map((observation) => ({
            asin: track.catalogProduct.asin ?? track.catalogProduct.id,
            observedAt: observation.observedAt.toISOString(),
            organicRank: observation.organicRank,
            sponsoredRank: observation.sponsoredRank,
          })),
        ),
      );
      return {
        keyword: {
          id: first.keyword.id,
          phrase: first.keyword.phrase,
          marketplaceId: first.marketplaceId,
        },
        calculationVersion: analytics.calculationVersion,
        products: keywordTracks.map((track) => {
          const key = track.catalogProduct.asin ?? track.catalogProduct.id;
          const metrics = analytics.products.find((item) => item.asin === key)!;
          const latest = track.observations[0];
          return {
            trackId: track.id,
            asin: track.catalogProduct.asin,
            title: track.catalogProduct.title,
            cadenceMinutes: track.cadenceMinutes,
            nextRunAt: track.nextRunAt?.toISOString() ?? null,
            latestProvider: latest?.providerKey ?? null,
            latestFreshness: latest?.freshnessState ?? "UNKNOWN",
            observationCount: track.observations.length,
            organic: metrics.organic,
            sponsored: metrics.sponsored,
            organicShareOfVoicePercent: metrics.organicShareOfVoicePercent,
            latestObservedAt: metrics.latestObservedAt,
          };
        }),
      };
    }),
  });
}
