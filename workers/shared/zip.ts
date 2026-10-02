import type { R2Bucket, R2ObjectBody } from "./cloudflare";

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_557;

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function objectBytes(object: R2ObjectBody): Promise<Uint8Array> {
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}

export class R2ZipArchive {
  private constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
    private readonly entries: Map<string, ZipEntry>,
  ) {}

  static async open(bucket: R2Bucket, key: string): Promise<R2ZipArchive> {
    const head = await bucket.head(key);
    if (!head) throw new Error(`R2 object not found: ${key}`);

    const tailLength = Math.min(head.size, MAX_EOCD_SEARCH);
    const tail = await bucket.get(key, {
      range: { offset: head.size - tailLength, length: tailLength },
    });
    if (!tail) throw new Error("Unable to read ZIP tail from R2");

    const tailBytes = await objectBytes(tail);
    const tailView = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength);
    let eocd = -1;
    for (let i = tailBytes.length - 22; i >= 0; i--) {
      if (u32(tailView, i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("ZIP EOCD record not found (Zip64 is not supported)");

    const entryCount = u16(tailView, eocd + 10);
    const centralSize = u32(tailView, eocd + 12);
    const centralOffset = u32(tailView, eocd + 16);

    const central = await bucket.get(key, {
      range: { offset: centralOffset, length: centralSize },
    });
    if (!central) throw new Error("Unable to read ZIP central directory from R2");

    const bytes = await objectBytes(central);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder("utf-8");
    const entries = new Map<string, ZipEntry>();

    let offset = 0;
    for (let index = 0; index < entryCount; index++) {
      if (offset + 46 > bytes.length || u32(view, offset) !== CENTRAL_SIGNATURE) {
        throw new Error(`Invalid ZIP central directory entry at offset ${offset}`);
      }

      const nameLength = u16(view, offset + 28);
      const extraLength = u16(view, offset + 30);
      const commentLength = u16(view, offset + 32);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

      entries.set(name, {
        name,
        compressionMethod: u16(view, offset + 10),
        compressedSize: u32(view, offset + 20),
        uncompressedSize: u32(view, offset + 24),
        localHeaderOffset: u32(view, offset + 42),
      });

      offset += 46 + nameLength + extraLength + commentLength;
    }

    return new R2ZipArchive(bucket, key, entries);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  async stream(name: string): Promise<ReadableStream<Uint8Array>> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`ZIP entry not found: ${name}`);

    const localHeader = await this.bucket.get(this.key, {
      range: { offset: entry.localHeaderOffset, length: 30 },
    });
    if (!localHeader) throw new Error(`Unable to read local header for ${name}`);
    const headerBytes = await objectBytes(localHeader);
    const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
    if (u32(view, 0) !== LOCAL_SIGNATURE) throw new Error(`Invalid local ZIP header for ${name}`);

    const nameLength = u16(view, 26);
    const extraLength = u16(view, 28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;

    const compressed = await this.bucket.get(this.key, {
      range: { offset: dataOffset, length: entry.compressedSize },
    });
    if (!compressed) throw new Error(`Unable to read ZIP data for ${name}`);

    if (entry.compressionMethod === 0) return compressed.body;
    if (entry.compressionMethod === 8) {
      return compressed.body.pipeThrough(
        new DecompressionStream("deflate-raw" as CompressionFormat),
      );
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${name}`);
  }
}
