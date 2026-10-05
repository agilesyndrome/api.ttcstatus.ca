import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { renderLocalizedHtml } from '../i18n/html.mjs';

export async function buildClassicAssets() {
  const [template, manifest, client] = await Promise.all([
    readFile('public/snake/v1/index.html', 'utf8'),
    readFile('public/snake/v1/site.webmanifest', 'utf8'),
    build({
      entryPoints: ['public/snake/v1/game.js'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      minify: true,
    }),
  ]);
  const messages = JSON.parse(
    await readFile('shared/i18n/locales/en-CA/messages.json', 'utf8'),
  );
  return {
    'index.html': await renderLocalizedHtml(template),
    'site.webmanifest': JSON.stringify(JSON.parse(manifest), (_, value) =>
      typeof value === 'string'
        ? value.replace(/\{\{i18n:([\w.-]+)\}\}/g, (_, key) => {
            if (!Object.hasOwn(messages, key))
              throw new Error(`Unknown manifest translation key: ${key}`);
            return messages[key];
          })
        : value,
    ),
    'game.js': client.outputFiles[0].text,
  };
}
