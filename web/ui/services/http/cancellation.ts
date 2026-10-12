/** Works on Mobile Safari without relying on newer AbortSignal.any/timeout helpers. */
export async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // A caller may have started an operation just as cancellation arrived.
    void operation.catch(() => {});
    throw signal.reason;
  }
  let stop = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    stop = () => signal.removeEventListener('abort', abort);
  });
  try {
    return await Promise.race([operation, interrupted]);
  } finally {
    stop();
  }
}
