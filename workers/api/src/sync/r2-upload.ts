import type {
  R2Bucket,
  R2MultipartOptions,
  R2UploadedPart,
} from '../../../shared/cloudflare/bindings';

// R2 requires every multipart part except the last to be at least 5 MiB.
// Keeping our parts at 10 MiB bounds Worker memory while leaving room for a
// final, smaller part.
const MULTIPART_PART_BYTES = 10 * 1024 * 1024;

export async function putStreamToR2(
  bucket: R2Bucket,
  key: string,
  stream: ReadableStream<Uint8Array>,
  options: R2MultipartOptions,
  maximumBytes: number,
): Promise<Awaited<ReturnType<R2Bucket['put']>>> {
  const upload = await bucket.createMultipartUpload(key, options);
  const reader = stream.getReader();
  const parts: R2UploadedPart[] = [];
  let chunks: Uint8Array[] = [];
  let chunkBytes = 0;
  let totalBytes = 0;
  let partNumber = 1;

  const flush = async (): Promise<void> => {
    if (chunkBytes === 0) return;
    const part = new Uint8Array(chunkBytes);
    let offset = 0;
    for (const chunk of chunks) {
      part.set(chunk, offset);
      offset += chunk.byteLength;
    }
    parts.push(await upload.uploadPart(partNumber++, part));
    chunks = [];
    chunkBytes = 0;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes)
        throw new Error(`Body exceeds ${maximumBytes} bytes`);
      chunks.push(value);
      chunkBytes += value.byteLength;
      if (chunkBytes >= MULTIPART_PART_BYTES) await flush();
    }
    await flush();

    // Empty objects cannot be represented by a multipart upload. This feed is
    // never expected to be empty, but keeping the helper total makes failures
    // deterministic and avoids leaving an open multipart upload behind.
    if (parts.length === 0) {
      await upload.abort();
      return bucket.put(key, new Uint8Array(0), options);
    }
    return upload.complete(parts);
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
