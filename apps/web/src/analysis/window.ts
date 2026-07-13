export const ANALYSIS_PAGE_SIZE = 100;
export const ANALYSIS_MAX_RENDERED_ROWS = 200;

export function pageOffsetForIndex(index: number): number {
  return Math.floor(index / ANALYSIS_PAGE_SIZE) * ANALYSIS_PAGE_SIZE;
}

/** A 50k scan is windowed; the browser never needs a 50k-row payload or DOM. */
export function requestedWindowOffsets(indexes: readonly number[]): number[] {
  return [...new Set(indexes.map(pageOffsetForIndex))];
}
