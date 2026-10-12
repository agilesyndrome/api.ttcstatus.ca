#!/usr/bin/env node
// Widen `dist/_headers` for local development (never deployed).
//
// `wrangler dev` serves `dist/` through the same Workers Assets pipeline as
// production, so `public/_headers` — including its enforced
// Content-Security-Policy — applies in `make dev` / `npm run dev:api`. That
// policy allows only the production Clerk frontend-api origin
// (clerk.ttcstatus.ca); a development Clerk instance (`pk_test_…`) instead
// loads its scripts from `<instance>.clerk.accounts.dev`, so without this
// patch the browser blocks every Clerk request in local dev.
//
// Dev-only widenings (see docs/security.md):
//   script-src / frame-src / form-action   https://*.clerk.accounts.dev
//   connect-src                            https://*.clerk.accounts.dev
//                                          https://*.protect.clerk.com:*  (Clerk fraud
//                                          protection hosts use non-443 ports)
//                                          https://clerk-telemetry.com + subdomains
//                                          (Clerk dev-instance telemetry)
//
// The classic snake policy stays fully self-contained and is never touched.
// `npm run build:ui` recreates `dist/_headers` from `public/_headers`, so the
// dev commands re-run this (idempotently) after every build.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = resolve(root, 'dist/_headers');
const source = resolve(root, 'public/_headers');

const additions = new Map([
  ['script-src', ['https://*.clerk.accounts.dev']],
  [
    'connect-src',
    [
      'https://*.clerk.accounts.dev',
      'https://*.protect.clerk.com:*',
      'https://clerk-telemetry.com',
      'https://*.clerk-telemetry.com',
    ],
  ],
  ['frame-src', ['https://*.clerk.accounts.dev']],
  ['form-action', ['https://*.clerk.accounts.dev']],
]);
const marker = '# dev-only CSP widening (scripts/dev/dev-headers.mjs)';

const read = async () =>
  (await readFile(built, 'utf8').catch(() => readFile(source, 'utf8'))).trimEnd();

const patchPolicy = (line) =>
  line.replace(/Content-Security-Policy:\s*(.*)/, (policy, directives) => {
    const widened = directives
      .split(';')
      .map((directive) => {
        const name = directive.trim().split(/\s+/)[0];
        // Append only the origins this policy is still missing, so re-runs
        // (and overlaps with the production policy) stay idempotent.
        const missing = (additions.get(name) ?? []).filter(
          (origin) => !directive.includes(origin),
        );
        return missing.length ? `${directive} ${missing.join(' ')}` : directive;
      })
      .join(';');
    return `Content-Security-Policy: ${widened}`;
  });

const headers = await read();
const lines = headers.split('\n');
const policyIndex = (list) =>
  list.findIndex((line) => /^\s*Content-Security-Policy:/.test(line));
let index = policyIndex(lines);
if (index < 0) throw new Error('no Content-Security-Policy found in _headers');
if (!lines.some((line) => line.trim() === marker)) {
  // The first CSP in the file is the site-wide `/*` policy; the snake block
  // below it keeps its own untouched policy.
  lines.splice(index, 0, marker);
  index = policyIndex(lines);
}
lines[index] = patchPolicy(lines[index]);
await mkdir(dirname(built), { recursive: true });
await writeFile(built, `${lines.join('\n')}\n`, 'utf8');
console.log('dist/_headers widened for dev: Clerk dev-instance domains allowed');
