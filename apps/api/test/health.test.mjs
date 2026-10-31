// Regression test for issue #20: /api/health must answer quickly even when the /home share (log
// file directory) hangs, and the server must listen before the application finishes loading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '..');
const entry = path.join(apiDir, 'src', 'server.ts');
const preload = path.join(here, 'stall-fs.mjs');
// Resolved here so the child can run from any cwd (the dotenv test runs from a temp dir).
const tsxLoader = import.meta.resolve('tsx');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

async function startServer(extraEnv, { cwd = apiDir, setup } = {}) {
  const port = await freePort();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'efm-health-'));
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    SESSION_SECRET: 'test-only-not-a-secret',
    LOG_FILE: path.join(tmp, 'home', 'LogFiles', 'iais', 'app.log'),
    DATABASE_URL: `file:${path.join(tmp, 'test.db')}`,
    ...extraEnv(tmp)
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const childCwd = typeof cwd === 'function' ? cwd(tmp) : cwd;
  if (setup) setup({ tmp, port, cwd: childCwd });
  const child = spawn(process.execPath, ['--import', tsxLoader, '--import', preload, entry], {
    cwd: childCwd, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const stop = () => { child.kill('SIGKILL'); rmSync(tmp, { recursive: true, force: true }); };
  return { port, stop, output: () => output };
}

async function get(port, p, timeoutMs) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Polls until the endpoint answers or the deadline passes; each attempt has a short timeout, so a
// listener that is up but blocked fails exactly like production (connection made, 0 bytes back).
async function waitFor(port, p, deadlineMs, predicate = () => true) {
  const deadline = Date.now() + deadlineMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await get(port, p, 1000);
      if (predicate(last)) return last;
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${p} did not answer within ${deadlineMs} ms (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

test('health answers within seconds while the /home share hangs', { timeout: 30000 }, async () => {
  const srv = await startServer((tmp) => ({ STALL_DIR: path.join(tmp, 'home') }));
  try {
    const started = Date.now();
    const health = await waitFor(srv.port, '/api/health', 10000);
    assert.equal(health.status, 200, srv.output());
    assert.equal(health.body.ok, true);
    // Once up, every probe must be fast, not just the first one.
    for (const p of ['/api/health', '/health', '/api/health']) {
      const t = Date.now();
      const r = await get(srv.port, p, 2000);
      assert.equal(r.status, 200);
      assert.ok(Date.now() - t < 1000, `${p} took ${Date.now() - t} ms`);
    }
    // The full app also loads (file logging is asynchronous and must not block it).
    const ready = await waitFor(srv.port, '/api/health', 15000, (r) => r.body?.ready === true);
    assert.equal(ready.body.initError, null);
    const diag = await get(srv.port, '/.well-known/openid-configuration', 2000);
    assert.equal(diag.status, 200);
    console.log(`health up in ${Date.now() - started} ms with a stalled /home`);
  } finally {
    srv.stop();
  }
});

test('health answers and app routes work with a healthy filesystem', { timeout: 30000 }, async () => {
  const srv = await startServer(() => ({}));
  try {
    const ready = await waitFor(srv.port, '/api/health', 15000, (r) => r.body?.ready === true);
    assert.equal(ready.status, 200);
    assert.equal((await get(srv.port, '/health', 2000)).status, 200);
    const mcp = await get(srv.port, '/.well-known/oauth-protected-resource', 2000);
    assert.equal(mcp.status, 200);
    // Routes behind auth still answer (401), proving the app is mounted after health.
    const refresh = await get(srv.port, '/api/refresh', 2000);
    assert.equal(refresh.status, 401);
  } finally {
    srv.stop();
  }
});

test('health stays up and reports the error when the application fails to load', { timeout: 30000 }, async () => {
  // production without SESSION_SECRET makes config.ts throw during app import
  const srv = await startServer(() => ({ SESSION_SECRET: undefined }));
  try {
    const health = await waitFor(srv.port, '/api/health', 15000, (r) => r.body?.initError);
    assert.equal(health.status, 200);
    assert.equal(health.body.ready, false);
    assert.match(health.body.initError, /SESSION_SECRET/);
    assert.equal((await get(srv.port, '/api/diag', 2000)).status, 503);
  } finally {
    srv.stop();
  }
});

test('listens on the PORT from .env when the environment does not set PORT', { timeout: 30000 }, async () => {
  // PORT exists only in <cwd>/.env; the listener must use it, not the 4000 default.
  const srv = await startServer(() => ({ PORT: undefined }), {
    cwd: (tmp) => tmp,
    setup: ({ tmp, port }) => writeFileSync(path.join(tmp, '.env'), `PORT=${port}\n`)
  });
  try {
    const health = await waitFor(srv.port, '/api/health', 15000, (r) => r.body?.ready === true);
    assert.equal(health.status, 200, srv.output());
    assert.match(srv.output(), new RegExp(`listening on port ${srv.port}\\b`));
  } finally {
    srv.stop();
  }
});
