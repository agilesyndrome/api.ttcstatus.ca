/** Byte limits apply to the stream, including bodies without Content-Length. */
export class BodyTooLargeError extends Error {
  constructor(readonly maximumBytes: number) {
    super(`Body exceeds ${maximumBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

export function limitStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): ReadableStream<Uint8Array> {
  let size = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maximumBytes) throw new BodyTooLargeError(maximumBytes);
        controller.enqueue(chunk);
      },
    }),
  );
}

export async function readLimitedBytes(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = limitStream(stream, maximumBytes).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
