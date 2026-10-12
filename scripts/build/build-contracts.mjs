import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';

const compiled = await build({
  entryPoints: ['workers/api/src/contracts/openapi.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { openApiDocument } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
await mkdir('docs/api', { recursive: true });
await writeFile(
  'docs/api/openapi.json',
  await format(JSON.stringify(openApiDocument), {
    ...(await resolveConfig('docs/api/openapi.json')),
    parser: 'json',
  }),
);
console.log('API contract generated.');
