import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();

async function* modules(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) yield* modules(file);
    else if (['.ts', '.tsx'].includes(extname(file))) yield file;
  }
}

const failures = [];
for (const area of ['shared', 'workers', 'web']) {
  for await (const file of modules(area)) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
        continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.'))
        continue;
      const target = relative(root, resolve(dirname(file), specifier.text));
      const forbidden =
        area === 'shared'
          ? ['workers/', 'web/']
          : area === 'workers'
            ? ['web/']
            : ['workers/'];
      if (forbidden.some((prefix) => target.startsWith(prefix))) {
        failures.push(`${file} imports ${specifier.text}`);
      }
    }
  }
}

if (failures.length) {
  console.error('Application boundaries violated:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Shared, Worker and browser module boundaries passed.');
}
