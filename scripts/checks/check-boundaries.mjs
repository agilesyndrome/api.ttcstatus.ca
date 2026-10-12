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
    const sourcePath = file.split(sep).join('/');
    const gradeImport = (specifier) => {
      if (!specifier || !ts.isStringLiteral(specifier)) return;
      if (
        specifier.text.startsWith('@capacitor/') &&
        !sourcePath.startsWith('web/ui/services/platform/')
      )
        failures.push(
          `${file} imports a native plugin outside the platform service boundary`,
        );
      if (!specifier.text.startsWith('.')) return;
      const target = resolve(dirname(join(root, file)), specifier.text);
      if (!target.startsWith(root + sep) && target !== root) {
        failures.push(`${file} imports outside the checkout: ${specifier.text}`);
        return;
      }
      const targetPath = relative(root, target).split(sep).join('/');
      if (
        sourcePath.startsWith('web/ui/services/') &&
        /^(web\/ui\/(features|components|hooks)\/)/.test(targetPath)
      )
        failures.push(`${file} imports UI implementation from a service`);
      const prefix = relative(root, target).split(sep)[0];
      if (forbiddenPrefixes[area].includes(prefix))
        failures.push(`${file} imports ${specifier.text}`);
    };
    // Grade static imports/re-exports and lazy imports through the same rules.
    const inspect = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        gradeImport(node.moduleSpecifier);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      )
        gradeImport(node.arguments[0]);
      if (
        sourcePath.startsWith('web/ui/') &&
        !sourcePath.startsWith('web/ui/services/')
      ) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'fetch'
        )
          failures.push(`${file} calls fetch outside the HTTP service`);
        if (ts.isIdentifier(node) && node.text === 'localStorage')
          failures.push(`${file} accesses localStorage outside the platform service`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
}

if (failures.length) {
  console.error('Application boundaries violated:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Shared, Worker and browser module boundaries passed.');
}
