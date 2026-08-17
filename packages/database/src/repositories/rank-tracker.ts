import { db } from "../client.js";
export async function recordKeywordRankObservation(input: {
  organizationId: string;
  trackId: string;
  providerKey: string;
  observedAt: Date;
  requestKey: string;
  organicRank?: number;
  sponsoredRank?: number;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
}) {
  const track = await db.keywordRankTrack.findFirst({
    where: { id: input.trackId, organizationId: input.organizationId },
  });
  if (!track) throw new Error("KEYWORD_RANK_TRACK_NOT_FOUND");
  return db.keywordRankObservation.upsert({
    where: {
      trackId_requestKey: {
        trackId: input.trackId,
        requestKey: input.requestKey,
      },
    },
    create: {
      ...input,
      organicRank: input.organicRank ?? null,
      sponsoredRank: input.sponsoredRank ?? null,
    },
    update: {},
  });
}
export async function listKeywordRankTracks(organizationId: string) {
  return db.keywordRankTrack.findMany({
    where: { organizationId },
    include: {
      keyword: true,
      catalogProduct: true,
      observations: { orderBy: { observedAt: "desc" }, take: 30 },
    },
    orderBy: { updatedAt: "desc" },
  });
}
