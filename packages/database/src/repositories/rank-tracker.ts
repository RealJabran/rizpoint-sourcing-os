import { Decimal } from "decimal.js";
import { db } from "../client.js";

export const KEYWORD_RANK_ANALYTICS_VERSION = "keyword-rank-analytics/v1";

export type KeywordRankAnalyticsObservation = {
  asin: string;
  observedAt: string;
  organicRank: number | null;
  sponsoredRank: number | null;
};

function rankStats(values: readonly number[]) {
  if (!values.length)
    return {
      latest: null,
      change: null,
      movingAverage: null,
      best: null,
      worst: null,
      volatility: null,
    };
  const latest = values.at(-1)!;
  const previous = values.at(-2);
  const moving = values.slice(-7);
  const average =
    moving.reduce((total, rank) => total + rank, 0) / moving.length;
  const variance =
    moving.reduce((total, rank) => total + (rank - average) ** 2, 0) /
    moving.length;
  return {
    latest,
    change: previous === undefined ? null : previous - latest,
    movingAverage: new Decimal(average).toFixed(2),
    best: Math.min(...values),
    worst: Math.max(...values),
    volatility: new Decimal(Math.sqrt(variance)).toFixed(2),
  };
}

/** Rank gain is positive when a product moves toward position one. Share of
 * voice is the latest reciprocal-rank share among observed competitors. */
export function calculateKeywordRankAnalytics(
  observations: readonly KeywordRankAnalyticsObservation[],
) {
  const byAsin = new Map<string, KeywordRankAnalyticsObservation[]>();
  for (const observation of observations) {
    if (!observation.asin.trim()) continue;
    byAsin.set(observation.asin, [
      ...(byAsin.get(observation.asin) ?? []),
      observation,
    ]);
  }
  const latestOrganic = new Map<string, number>();
  const rows = [...byAsin.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([asin, entries]) => {
      const ordered = [...entries].sort(
        (left, right) =>
          Date.parse(left.observedAt) - Date.parse(right.observedAt),
      );
      const organicValues = ordered.flatMap((item) =>
        item.organicRank && item.organicRank > 0 ? [item.organicRank] : [],
      );
      const sponsoredValues = ordered.flatMap((item) =>
        item.sponsoredRank && item.sponsoredRank > 0
          ? [item.sponsoredRank]
          : [],
      );
      const latest = ordered.at(-1);
      if (latest?.organicRank && latest.organicRank > 0)
        latestOrganic.set(asin, latest.organicRank);
      return {
        asin,
        organic: rankStats(organicValues),
        sponsored: rankStats(sponsoredValues),
        latestObservedAt: latest?.observedAt ?? null,
      };
    });
  const visibilityTotal = [...latestOrganic.values()].reduce(
    (total, rank) => total.plus(new Decimal(1).div(rank)),
    new Decimal(0),
  );
  return {
    calculationVersion: KEYWORD_RANK_ANALYTICS_VERSION,
    products: rows.map((row) => ({
      ...row,
      organicShareOfVoicePercent:
        visibilityTotal.isZero() || !latestOrganic.has(row.asin)
          ? null
          : new Decimal(1)
              .div(latestOrganic.get(row.asin)!)
              .div(visibilityTotal)
              .times(100)
              .toFixed(2),
    })),
  };
}

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

export const RANK_TRACKER_PAGE_LIMIT = 200;

export async function listKeywordRankTracks(input: {
  organizationId: string;
  offset?: number;
  limit?: number;
}) {
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(
    RANK_TRACKER_PAGE_LIMIT,
    Math.max(1, input.limit ?? 100),
  );
  const where = { organizationId: input.organizationId };
  const [total, rows] = await db.$transaction([
    db.keywordRankTrack.count({ where }),
    db.keywordRankTrack.findMany({
      where,
      include: {
        keyword: true,
        catalogProduct: true,
        observations: { orderBy: { observedAt: "desc" }, take: 30 },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: limit,
    }),
  ]);
  return { total, offset, limit, rows };
}
