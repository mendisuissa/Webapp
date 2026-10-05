import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { materializeRuntimeWorkspaces } from './materialize-runtime-workspaces.mjs';

function fixture({ packageName = '@efm/shared', includeRuntime = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'efm-runtime-package-'));
  const source = join(root, 'packages', 'shared');
  mkdirSync(join(source, 'dist'), { recursive: true });
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: packageName,
    type: 'module',
    exports: { '.': { import: './dist/index.js' } },
  }));
  if (includeRuntime) {
    writeFileSync(join(source, 'dist', 'index.js'), 'export const value = 1;\n');
    writeFileSync(join(source, 'dist', 'index.d.ts'), 'export declare const value = 1;\n');
  }
  mkdirSync(join(root, 'node_modules', '@efm'), { recursive: true });
  return { root, source, destination: join(root, 'node_modules', '@efm', 'shared') };
}

function clean(root) {
  rmSync(root, { recursive: true, force: true });
}

test('materializes the runtime workspace instead of retaining a package link', () => {
  const f = fixture();
  try {
    symlinkSync(f.source, f.destination, process.platform === 'win32' ? 'junction' : 'dir');
    const result = materializeRuntimeWorkspaces({ root: f.root });
    assert.equal(result.materialized, true);
    assert.equal(readFileSync(join(f.destination, 'dist', 'index.js'), 'utf8'), 'export const value = 1;\n');
    writeFileSync(join(f.source, 'dist', 'index.js'), 'export const value = 2;\n');
    assert.equal(readFileSync(join(f.destination, 'dist', 'index.js'), 'utf8'), 'export const value = 1;\n');
  } finally {
    clean(f.root);
  }
});

test('replaces stale runtime content deterministically', () => {
  const f = fixture();
  try {
    mkdirSync(f.destination, { recursive: true });
    writeFileSync(join(f.destination, 'stale.txt'), 'must disappear');
    materializeRuntimeWorkspaces({ root: f.root });
    assert.throws(() => readFileSync(join(f.destination, 'stale.txt')), /ENOENT/);
    assert.equal(readFileSync(join(f.destination, 'package.json'), 'utf8'), readFileSync(join(f.source, 'package.json'), 'utf8'));
  } finally {
    clean(f.root);
  }
});

test('fails closed for an unexpected workspace identity', () => {
  const f = fixture({ packageName: '@efm/forged' });
  try {
    assert.throws(() => materializeRuntimeWorkspaces({ root: f.root }), /DEPLOY_PACKAGE_UNEXPECTED_WORKSPACE/);
  } finally {
    clean(f.root);
  }
});

test('fails closed when built runtime files are absent', () => {
  const f = fixture({ includeRuntime: false });
  try {
    assert.throws(() => materializeRuntimeWorkspaces({ root: f.root }), /DEPLOY_PACKAGE_MISSING_SOURCE/);
  } finally {
    clean(f.root);
  }
});
