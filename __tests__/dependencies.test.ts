/**
 * Every package the source imports must be declared in `package.json`.
 *
 * npm hoists transitive dependencies into the top of `node_modules`, so an
 * import of a package nobody declared resolves perfectly well on the machine
 * that wrote it — and on CI, as long as the tree happens to dedupe the same
 * way. It stops resolving the moment a dependency is bumped, npm changes how it
 * flattens, or someone installs with different flags. The failure then lands on
 * a contributor or a release build, far from the change that caused it.
 *
 * That is not hypothetical here: `workletSafety.test.ts` reached straight for
 * `@babel/parser`, `@babel/traverse`, `@babel/generator` and `@babel/types`,
 * none of which were declared. They resolved only because `@babel/core` pulls
 * them in. To watch this fail, delete one of those from `devDependencies`.
 *
 * @format
 */

/// <reference types="node" />

import { builtinModules } from 'module';
import { readdirSync, readFileSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import packageJson from '../package.json';

const ROOT = resolve(__dirname, '..');

/** Everything that ships or is built from, including the tests that guard it. */
const SCANNED = ['src', '__tests__', 'testing', 'App.tsx', 'index.js'];

const declared = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
]);
const builtins = new Set(builtinModules);

function sourceFiles(target: string): string[] {
  const path = resolve(ROOT, target);
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return ['.ts', '.tsx', '.js', '.jsx'].includes(extname(path)) ? [path] : [];
  }
  return entries.flatMap(entry =>
    entry.isDirectory()
      ? sourceFiles(join(target, entry.name))
      : sourceFiles(join(target, entry.name)),
  );
}

/**
 * The package a module specifier belongs to — `react-native` for
 * `react-native/jest/x`, `@babel/core` for `@babel/core/lib/y`. Relative and
 * absolute specifiers resolve to a file in this repo and have no package.
 */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/** Every package specifier a file imports or requires, read off the AST. */
function importsOf(file: string): string[] {
  const found = new Set<string>();
  const ast = parse(readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx'],
  });

  const record = (specifier: string) => {
    const name = packageOf(specifier);
    if (name != null) found.add(name);
  };

  traverse(ast, {
    // Type-only imports count: `tsc` has to resolve them too.
    ImportDeclaration: path => record(path.node.source.value),
    ExportNamedDeclaration: path => {
      if (path.node.source) record(path.node.source.value);
    },
    ExportAllDeclaration: path => record(path.node.source.value),
    CallExpression: path => {
      const callee = path.node.callee;
      const isRequire = t.isIdentifier(callee, { name: 'require' });
      const isJestMock =
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'jest' }) &&
        t.isIdentifier(callee.property) &&
        ['mock', 'unmock', 'requireActual', 'requireMock'].includes(callee.property.name);
      if (!isRequire && !isJestMock) return;
      const [first] = path.node.arguments;
      if (t.isStringLiteral(first)) record(first.value);
    },
  });

  return [...found];
}

const FILES = SCANNED.flatMap(sourceFiles);

it('scans the source it claims to scan', () => {
  // Without this, a rename of `src/` would leave the check below passing on an
  // empty file list — a test that cannot fail.
  expect(FILES.length).toBeGreaterThan(50);
  expect(FILES.some(f => f.endsWith('src/components/CameraFeed.tsx'))).toBe(true);
});

it('declares every package it imports', () => {
  const undeclared = FILES.flatMap(file =>
    importsOf(file)
      .filter(name => !declared.has(name) && !builtins.has(name))
      .map(name => `${name}  <-  ${relative(ROOT, file)}`),
  );

  expect(Array.from(new Set(undeclared)).sort()).toEqual([]);
});
