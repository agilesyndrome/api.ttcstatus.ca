import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// CODEMAP.md contract: `shared/` imports neither application, Worker code never
// imports browser implementation files, and browser code never imports Worker
// implementation files. `tsc` resolves every module; this check only grades the
// direction of relative import specifiers.
const root = resolve(process.cwd());
const forbiddenPrefixes = {
  shared: ['workers', 'web'],
  workers: ['web'],
  web: ['workers'],
};
const sourceExtensions = new Set(['.ts', '.tsx']);

// Walk a fixed repository-relative area. `readdir` entry names cannot contain
// path separators, symlinks are skipped, and every candidate is confirmed to
// stay inside the checkout, so no entry can redirect the scan or the reads.
async function* sources(area) {
  for (const entry of await readdir(join(root, area), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = join(area, entry.name);
    if (entry.isDirectory()) yield* sources(file);
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) yield file;
  }
}

const failures = [];
for (const area of ['shared', 'workers', 'web']) {
  for await (const file of sources(area)) {
    const source = ts.createSourceFile(
      file,
      await readFile(join(root, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
        continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.'))
        continue;
      const target = resolve(dirname(join(root, file)), specifier.text);
      if (!target.startsWith(root + sep) && target !== root) {
        failures.push(`${file} imports outside the checkout: ${specifier.text}`);
        continue;
      }
      const prefix = relative(root, target).split(sep)[0];
      if (forbiddenPrefixes[area].includes(prefix))
        failures.push(`${file} imports ${specifier.text}`);
    }
  }
}

if (failures.length) {
  console.error('Application boundaries violated:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Shared, Worker and browser module boundaries passed.');
}
