import { build } from 'esbuild';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after } from 'node:test';

export async function compileModules(contents) {
  const result = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  const directory = await mkdtemp(join(tmpdir(), 'ttc-tests-'));
  after(() => rm(directory, { recursive: true, force: true }));
  await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
  const file = join(directory, 'modules.mjs');
  await writeFile(file, result.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}
