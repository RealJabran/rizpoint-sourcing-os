const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

/** Companion tokens may only be sent to HTTPS origins (or loopback during
 * local development). Credentials, query strings, fragments, and paths are
 * discarded so a copied endpoint cannot redirect token placement. */
export function normalizeBackendUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash) return null;
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && loopbackHosts.has(url.hostname))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
