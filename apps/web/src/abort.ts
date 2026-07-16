export function requestWasAborted(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function abortExpectedRequest(controller: AbortController): void {
  if (controller.signal.aborted) return;
  controller.abort(new DOMException("Component unmounted", "AbortError"));
}
