export const marketByHost: Record<string, string> = {
  "amazon.com": "ATVPDKIKX0DER",
  "amazon.co.uk": "A1F83G8C2ARO7P",
  "amazon.de": "A1PA6795UKMFR9",
  "amazon.ca": "A2EUQ1WTGCTBG2",
};
export function targetFromUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const asin =
    /(?:\/dp\/|\/gp\/product\/|[?&](?:asin|ASIN)=)([A-Z0-9]{10})(?:[/?&]|$)/i
      .exec(`${url.pathname}${url.search}`)?.[1]
      ?.toUpperCase() ?? null;
  return {
    url: url.toString(),
    host,
    marketplaceId: marketByHost[host] ?? null,
    asin,
  };
}
