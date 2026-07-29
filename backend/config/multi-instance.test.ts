/**
 * backend/config/multi-instance.test.ts - Multi-instance startup guard tests
 *
 * End-to-end checks of the server boot guards (server.ts start()):
 *   - REDIS_URL with a non-redis STORE_BACKEND is a split-brain
 *     misconfiguration and must fail fast (exit 1) with a clear message.
 *   - REDIS_URL pointing at an unreachable Redis must also fail fast —
 *     never hang, never silently degrade to single-instance mode.
 *
 * Each case boots the real server entry in a child process (no Docker on
 * this machine, so 127.0.0.1:6399 is guaranteed unreachable).
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const UNREACHABLE_REDIS = 'redis://127.0.0.1:6399';

/** Boot server.ts in a child process; resolve with exit code + output. */
function bootServer(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: ROOT,
      env: { ...process.env, PORT: '0', NODE_ENV: 'test', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: any) => { output += chunk; });
    child.stderr.on('data', (chunk: any) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code: number | null) => resolve({ code, output }));
    // Safety net: a fail-fast boot must never hang; kill if it does.
    setTimeout(() => child.kill('SIGKILL'), 45000).unref();
  });
}

test('REDIS_URL with STORE_BACKEND=memory fails fast as a split-brain misconfiguration', { timeout: 60000 }, async () => {
  const { code, output } = await bootServer({
    REDIS_URL: UNREACHABLE_REDIS,
    STORE_BACKEND: 'memory',
  });
  assert.equal(code, 1, 'the server must exit 1');
  assert.ok(
    output.includes('REDIS_URL requires STORE_BACKEND=redis'),
    `expected the split-brain guard message, got:\n${output}`
  );
});

test('REDIS_URL with STORE_BACKEND=redis but unreachable Redis fails fast', { timeout: 60000 }, async () => {
  const { code, output } = await bootServer({
    REDIS_URL: UNREACHABLE_REDIS,
    STORE_BACKEND: 'redis',
  });
  assert.equal(code, 1, 'the server must exit 1');
  assert.ok(
    output.includes('refusing to start'),
    `expected the unreachable-redis message, got:\n${output}`
  );
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
