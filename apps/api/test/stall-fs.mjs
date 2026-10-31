// Test preload: simulates a stalled network share (the App Service /home SMB mount) at STALL_DIR.
// Any synchronous fs call on a path under it blocks the thread (like a hung SMB stat/open), and
// any asynchronous call never completes. Paths elsewhere behave normally.
import fs from 'node:fs';
import path from 'node:path';

const stallDir = process.env.STALL_DIR ? path.resolve(process.env.STALL_DIR) : '';
const blockMs = Number(process.env.STALL_SYNC_MS ?? 120000);

const stalled = (p) => {
  if (!stallDir || p === undefined || p === null || typeof p === 'number') return false;
  const s = path.resolve(String(p instanceof URL ? p.pathname : p));
  return s === stallDir || s.startsWith(stallDir + path.sep);
};

const blockThread = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, blockMs);

for (const name of ['existsSync', 'statSync', 'lstatSync', 'mkdirSync', 'openSync', 'accessSync', 'readFileSync', 'writeFileSync', 'appendFileSync']) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) {
    if (stalled(p)) blockThread();
    return orig.call(this, p, ...rest);
  };
}
for (const name of ['mkdir', 'open', 'stat', 'lstat', 'access', 'readFile', 'writeFile', 'appendFile']) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) {
    if (stalled(p)) return undefined; // callback never fires
    return orig.call(this, p, ...rest);
  };
}
for (const name of ['mkdir', 'open', 'stat', 'lstat', 'access', 'readFile', 'writeFile', 'appendFile']) {
  const orig = fs.promises[name];
  fs.promises[name] = function (p, ...rest) {
    if (stalled(p)) return new Promise(() => {});
    return orig.call(this, p, ...rest);
  };
}
