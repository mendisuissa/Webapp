import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_PACKAGE = '@efm/shared';
const SOURCE_RELATIVE = join('packages', 'shared');
const DESTINATION_RELATIVE = join('node_modules', '@efm', 'shared');
const REQUIRED_RUNTIME_FILES = Object.freeze([
  'package.json',
  join('dist', 'index.js'),
  join('dist', 'index.d.ts'),
]);

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertInside(root, candidate, label) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`DEPLOY_PACKAGE_PATH_ESCAPE:${label}`);
  }
}

function readPackage(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`DEPLOY_PACKAGE_INVALID_MANIFEST:${error instanceof Error ? error.message : 'unknown'}`);
  }
}

export function materializeRuntimeWorkspaces({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  const repositoryRoot = resolve(root);
  const source = resolve(repositoryRoot, SOURCE_RELATIVE);
  const destination = resolve(repositoryRoot, DESTINATION_RELATIVE);
  const nodeModulesRoot = resolve(repositoryRoot, 'node_modules');

  assertInside(repositoryRoot, source, 'source');
  assertInside(nodeModulesRoot, destination, 'destination');

  const manifestPath = join(source, 'package.json');
  const manifest = readPackage(manifestPath);
  if (manifest.name !== EXPECTED_PACKAGE) throw new Error('DEPLOY_PACKAGE_UNEXPECTED_WORKSPACE');
  if (manifest.exports?.['.']?.import !== './dist/index.js') throw new Error('DEPLOY_PACKAGE_UNEXPECTED_EXPORT');

  for (const relative of REQUIRED_RUNTIME_FILES) {
    if (!existsSync(join(source, relative))) throw new Error(`DEPLOY_PACKAGE_MISSING_SOURCE:${relative.replaceAll('\\', '/')}`);
  }

  if (existsSync(destination) || lstatExists(destination)) rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(manifestPath, join(destination, 'package.json'));
  cpSync(join(source, 'dist'), join(destination, 'dist'), { recursive: true });

  if (lstatSync(destination).isSymbolicLink()) throw new Error('DEPLOY_PACKAGE_RUNTIME_WORKSPACE_IS_LINK');
  if (realpathSync(destination) !== destination) throw new Error('DEPLOY_PACKAGE_RUNTIME_WORKSPACE_NOT_MATERIALIZED');

  for (const relative of REQUIRED_RUNTIME_FILES) {
    const sourceHash = sha256(join(source, relative));
    const destinationHash = sha256(join(destination, relative));
    if (sourceHash !== destinationHash) throw new Error(`DEPLOY_PACKAGE_HASH_MISMATCH:${relative.replaceAll('\\', '/')}`);
  }

  return Object.freeze({
    package: EXPECTED_PACKAGE,
    source: SOURCE_RELATIVE.replaceAll('\\', '/'),
    destination: DESTINATION_RELATIVE.replaceAll('\\', '/'),
    materialized: true,
  });
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const result = materializeRuntimeWorkspaces();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
