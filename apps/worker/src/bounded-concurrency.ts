export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new Error("CONCURRENCY_LIMIT_INVALID");
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
