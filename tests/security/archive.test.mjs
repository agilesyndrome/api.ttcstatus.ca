import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { compileModules } from '../helpers/compile.mjs';

const { R2ZipArchive } = await compileModules(
  `export { R2ZipArchive } from './workers/shared/gtfs/zip';`,
);
function archive(text, { method = 8, declaredSize = Buffer.byteLength(text) } = {}) {
  const name = Buffer.from('routes.txt');
  const content = method === 8 ? deflateRawSync(text) : Buffer.from(text);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(name.length, 28);
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50, 0);
  tail.writeUInt16LE(1, 10);
  tail.writeUInt32LE(central.length + name.length, 12);
  tail.writeUInt32LE(local.length + name.length + content.length, 16);
  return {
    bytes: Buffer.concat([local, name, content, central, name, tail]),
    tail,
    local,
  };
}
function bucket(bytes) {
  return {
    async head() {
      return { size: bytes.length };
    },
    async get(_key, { range }) {
      return {
        body: new Response(bytes.subarray(range.offset, range.offset + range.length))
          .body,
      };
    },
  };
}

test('ranged ZIP parsing preserves stored and deflated GTFS members', async () => {
  for (const method of [0, 8]) {
    const fixture = archive('route_id,route_type\n501,0\n', { method });
    const zip = await R2ZipArchive.open(bucket(fixture.bytes), 'fixture');
    assert.deepEqual(zip.names(), ['routes.txt']);
    assert.equal(
      await new Response(await zip.stream('routes.txt')).text(),
      'route_id,route_type\n501,0\n',
    );
  }
});

test('decompression refuses content larger than its declared member size', async () => {
  const fixture = archive('x'.repeat(100_000), { declaredSize: 10 });
  const zip = await R2ZipArchive.open(bucket(fixture.bytes), 'fixture');
  await assert.rejects(
    new Response(await zip.stream('routes.txt')).arrayBuffer(),
    /exceeds/,
  );
});

test('ZIP metadata cannot request a directory or member outside archive bounds', async () => {
  const fixture = archive('small');
  fixture.bytes.writeUInt32LE(3_000_000, fixture.bytes.length - 22 + 12);
  await assert.rejects(R2ZipArchive.open(bucket(fixture.bytes), 'fixture'), /directory/);
  const invalid = archive('small');
  invalid.bytes.writeUInt16LE(65_000, 28);
  const zip = await R2ZipArchive.open(bucket(invalid.bytes), 'fixture');
  await assert.rejects(zip.stream('routes.txt'), /archive bounds/);
});
