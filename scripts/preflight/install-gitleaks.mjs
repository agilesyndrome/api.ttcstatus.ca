#!/usr/bin/env node
// Installs the pinned gitleaks release into the configured tools directory —
// on whatever OS Node itself runs on. Nothing here assumes Linux, macOS or
// Windows beyond picking the matching release asset:
//
//   1. platform/arch are detected (gitleaks publishes linux/darwin/windows
//      builds; the asset name follows gitleaks_<version>_<os>_<arch>);
//   2. the archive is downloaded over HTTPS;
//   3. its SHA-256 must match the digest pinned in security.json (or the
//      release's own checksums.txt) — an unverified binary is never kept;
//   4. it is extracted with Node's own zlib (tar.gz and zip are both parsed
//      here), so the machine needs neither tar, unzip, nor PowerShell.
//
// Configure in security.json: tools.gitleaks.version + tools.gitleaks.sha256.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import process from 'node:process';
import { PreFlightError, ROOT, loadConfig } from './config.mjs';

const OS_BY_PLATFORM = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
const ARCH_BY_ARCH = { x64: 'x64', arm64: 'arm64', ia32: 'x32', arm: 'armv7' };
const OS = OS_BY_PLATFORM[process.platform];
const ARCH = ARCH_BY_ARCH[process.arch];

const log = (text) => console.log(`gitleaks: ${text}`);
const fail = (message) => {
  console.error(`gitleaks: ${message}`);
  process.exit(1);
};

function readTarString(block, offset, length) {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.toString('utf8', 0, end === -1 ? length : end);
}

function readTarSize(block) {
  const text = readTarString(block, 124, 12).trim();
  return text ? parseInt(text, 8) : 0;
}

/** Minimal ustar/GNU tar reader — enough for a release tarball. */
function extractTarGz(archive, dest) {
  const data = gunzipSync(archive);
  let offset = 0;
  let longName = null;
  while (offset + 512 <= data.length) {
    const block = data.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) break; // end-of-archive padding
    const name = readTarString(block, 0, 100);
    const size = readTarSize(block);
    const type = String.fromCharCode(block[156]);
    const prefix = readTarString(block, 345, 155);
    const content = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      // GNU long-name record: names the file described by the next header.
      longName = content.toString('utf8').replace(/\0.*/, '');
      continue;
    }
    if (type === 'x' || type === 'g') continue; // pax metadata blocks
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if (path.startsWith('/') || path.split('/').includes('..')) {
      fail(`refusing unsafe archive path: ${path}`);
    }
    if (type === '5' || path.endsWith('/')) continue; // directory entry
    if (type !== '0' && type !== '\0' && type !== '7') continue; // links, fifos…
    const out = join(dest, ...path.split('/'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content);
  }
}

/** Minimal zip reader: stored + deflated entries, no ZIP64 (none needed). */
function extractZip(archive, dest) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  const floor = Math.max(0, archive.length - 66_000);
  for (let i = archive.length - 22; i >= floor; i--) {
    if (archive.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail('could not find the zip directory in the archive');
  const entryCount = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  for (let entry = 0; entry < entryCount; entry++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) fail('corrupt zip directory entry');
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue; // directory entry
    if (flags & 0x1) fail(`encrypted zip entry: ${name}`);
    if (archive.readUInt32LE(localOffset) !== 0x04034b50)
      fail('corrupt zip local header');
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = archive.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = raw;
    else if (method === 8) content = inflateRawSync(raw);
    else fail(`unsupported zip compression method ${method} for ${name}`);
    if (name.startsWith('/') || name.split('/').includes('..')) {
      fail(`refusing unsafe archive path: ${name}`);
    }
    const out = join(dest, ...name.split('/'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content);
  }
}

function findBinary(dir, binaryName) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(path, binaryName);
      if (found) return found;
    } else if (entry.name === binaryName) return path;
  }
  return null;
}

function runBinary(path, args) {
  return spawnSync(path, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

try {
  if (!OS || !ARCH) {
    fail(`no gitleaks release matches ${process.platform}-${process.arch}.`);
  }
  const config = await loadConfig();
  const spec = config.tools?.gitleaks ?? {};
  const version = spec.version;
  if (!version)
    fail('no gitleaks version pinned in security.json (tools.gitleaks.version).');
  const toolsDir = join(ROOT, config.toolsDir ?? '.tools');
  const platformKey = `${OS}-${ARCH}`;
  const isWindows = OS === 'windows';
  const binaryName = isWindows ? 'gitleaks.exe' : 'gitleaks';
  const target = join(toolsDir, binaryName);

  // Already installed at the pinned version? Nothing to do.
  if (existsSync(target)) {
    const current = runBinary(target, ['version']);
    if (current.status === 0 && `${current.stdout}`.includes(version)) {
      log(
        `version ${version} already present at ${config.toolsDir ?? '.tools'}/${binaryName}`,
      );
      process.exit(0);
    }
  }

  const asset = `gitleaks_${version}_${OS}_${ARCH}${isWindows ? '.zip' : '.tar.gz'}`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${asset}`;
  log(`downloading ${asset} for ${platformKey}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) fail(`download failed: HTTP ${response.status} — ${url}`);
  const archive = Buffer.from(await response.arrayBuffer());
  log(`received ${(archive.length / 1e6).toFixed(1)} MB`);

  const digest = createHash('sha256').update(archive).digest('hex');
  let expected =
    typeof spec.sha256?.[platformKey] === 'string' ? spec.sha256[platformKey] : null;
  if (!expected) {
    log('no pinned digest for this platform — checking the release checksums.txt');
    const checksumUrl = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_checksums.txt`;
    const checksums = await fetch(checksumUrl, { signal: AbortSignal.timeout(60_000) });
    if (checksums.ok) {
      const line = (await checksums.text())
        .split('\n')
        .find((entry) => entry.includes(asset));
      expected = line?.split(/\s+/)[0] ?? null;
    }
  }
  if (!expected)
    fail(`no SHA-256 available for ${asset} — refusing an unverified download.`);
  if (expected !== digest) {
    fail(
      `SHA-256 mismatch for ${asset}\n  expected ${expected}\n  actual   ${digest}\n` +
        'The download did not match the pinned release. Nothing was installed.',
    );
  }
  log(`sha256 verified (${digest.slice(0, 16)}…)`);

  const stage = join(toolsDir, '.stage');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  if (isWindows) extractZip(archive, stage);
  else extractTarGz(archive, stage);

  const found = findBinary(stage, binaryName);
  if (!found) fail(`could not find ${binaryName} inside the downloaded archive.`);
  mkdirSync(toolsDir, { recursive: true });
  rmSync(target, { force: true });
  try {
    renameSync(found, target);
  } catch {
    copyFileSync(found, target); // cross-device fallback
  }
  if (!isWindows) chmodSync(target, 0o755);
  rmSync(stage, { recursive: true, force: true });

  const check = runBinary(target, ['version']);
  if (check.status !== 0) fail(`installed binary failed to run (exit ${check.status}).`);
  log(
    `ready — ${`${check.stdout}`.trim() || version} at ${config.toolsDir ?? '.tools'}/${binaryName}`,
  );
} catch (error) {
  if (error instanceof PreFlightError) fail(error.message);
  fail(error instanceof Error ? error.stack : String(error));
}
