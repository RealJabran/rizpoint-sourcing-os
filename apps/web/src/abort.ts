export function requestWasAborted(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}
