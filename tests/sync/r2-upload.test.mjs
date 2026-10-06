import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { putStreamToR2 } = await compileModules(`
  export { putStreamToR2 } from './workers/api/src/sync/r2-upload';
`);

test('uploads unknown-length streams through bounded R2 multipart parts', async () => {
  const uploaded = [];
  let completed;
  const bucket = {
    async createMultipartUpload(key, options) {
      assert.equal(key, 'gtfs/test.zip');
      assert.equal(options.customMetadata.source, 'test');
      return {
        async uploadPart(partNumber, value) {
          uploaded.push({ partNumber, bytes: new Uint8Array(value) });
          return { partNumber, etag: `part-${partNumber}` };
        },
        async complete(parts) {
          completed = parts;
          return {
            key,
            etag: 'multipart-etag',
            size: uploaded.reduce((n, part) => n + part.bytes.byteLength, 0),
          };
        },
        async abort() {
          throw new Error('abort should not be called');
        },
      };
    },
  };
  const first = new Uint8Array(6 * 1024 * 1024);
  first.fill(1);
  const second = new Uint8Array(6 * 1024 * 1024);
  second.fill(2);
  const third = new Uint8Array([3, 4, 5]);

  const stored = await putStreamToR2(
    bucket,
    'gtfs/test.zip',
    new ReadableStream({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.enqueue(third);
        controller.close();
      },
    }),
    { customMetadata: { source: 'test' } },
    20 * 1024 * 1024,
  );

  assert.equal(stored.etag, 'multipart-etag');
  assert.deepEqual(
    uploaded.map(({ partNumber, bytes }) => [partNumber, bytes.byteLength]),
    [
      [1, 10 * 1024 * 1024],
      [2, 2 * 1024 * 1024 + 3],
    ],
  );
  assert.deepEqual(completed, [
    { partNumber: 1, etag: 'part-1' },
    { partNumber: 2, etag: 'part-2' },
  ]);
});
