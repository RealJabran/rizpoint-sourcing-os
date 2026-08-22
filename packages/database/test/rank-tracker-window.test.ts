import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const findMany = vi.fn();
const transaction = vi.fn();

vi.mock("../src/client.js", () => ({
  db: {
    $transaction: transaction,
    keywordRankTrack: { count, findMany },
  },
}));

describe("rank tracker read window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    count.mockReturnValue("count-query");
    findMany.mockReturnValue("rows-query");
    transaction.mockResolvedValue([250, []]);
  });

  it("bounds tenant-scoped tracks and each observation history", async () => {
    const { listKeywordRankTracks } =
      await import("../src/repositories/rank-tracker.js");

    const result = await listKeywordRankTracks({
      organizationId: "org-current",
      offset: -1,
      limit: 500,
    });

    expect(count).toHaveBeenCalledWith({
      where: { organizationId: "org-current" },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-current" },
        skip: 0,
        take: 200,
        include: expect.objectContaining({
          observations: expect.objectContaining({ take: 30 }),
        }),
      }),
    );
    expect(result).toMatchObject({ total: 250, offset: 0, limit: 200 });
  });
});
