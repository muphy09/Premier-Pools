import assert from 'node:assert/strict';
import { mock } from 'node:test';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true },
});

const {
  getSupabaseReachability,
  resetSupabaseReachabilityForTests,
} = await import('../src/services/supabaseClient');

const setFetch = (implementation: typeof fetch) => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: implementation,
  });
};

resetSupabaseReachabilityForTests();
setFetch(async () => new Response('{}', { status: 200 }));
assert.deepEqual(await getSupabaseReachability(true), { reachable: true, reason: null });

resetSupabaseReachabilityForTests();
let fallbackCalls = 0;
setFetch(async (input) => {
  fallbackCalls += 1;
  if (String(input).endsWith('/auth/v1/health')) throw new Error('health route blocked');
  return new Response('{}', { status: 200 });
});
assert.deepEqual(await getSupabaseReachability(true), { reachable: true, reason: null });
assert.equal(fallbackCalls, 2, 'Auth settings fallback was not checked');

resetSupabaseReachabilityForTests();
let healthy = true;
setFetch(async () => healthy ? new Response('{}', { status: 200 }) : Promise.reject(new Error('temporary failure')));
assert.equal((await getSupabaseReachability(true)).reachable, true);
healthy = false;
assert.equal(
  (await getSupabaseReachability(true)).reachable,
  true,
  'One transient failed check incorrectly switched the app offline'
);
assert.deepEqual(await getSupabaseReachability(true), {
  reachable: false,
  reason: 'server-issue',
});

resetSupabaseReachabilityForTests();
let concurrentCalls = 0;
setFetch(async () => {
  concurrentCalls += 1;
  return new Response('{}', { status: 200 });
});
await Promise.all([
  getSupabaseReachability(true),
  getSupabaseReachability(true),
  getSupabaseReachability(true),
]);
assert.equal(concurrentCalls, 1, 'Concurrent cloud checks were not deduplicated');

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: false },
});
assert.deepEqual(await getSupabaseReachability(true), {
  reachable: true,
  reason: null,
}, 'A forced check must test the cloud even when the OS offline hint is stale');
setFetch(async () => { throw new TypeError('Failed to fetch'); });
assert.deepEqual(await getSupabaseReachability(true), {
  reachable: false,
  reason: 'no-internet',
});

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
resetSupabaseReachabilityForTests();
const diagnostics = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (key: string) => diagnostics.get(key), setItem: (key: string, value: string) => diagnostics.set(key, value) },
});
setFetch(async () => new Response('{}', { status: 503 }));
assert.deepEqual(await getSupabaseReachability(true), { reachable: false, reason: 'server-issue' });
setFetch(async (_, init) => {
  assert.equal(init?.cache, 'no-store', 'Retries must not reuse a cached HTTP error');
  return new Response('{}', { status: 200 });
});
assert.equal((await getSupabaseReachability()).reachable, false, 'Failure should be briefly cached');
assert.equal((await getSupabaseReachability(true)).reachable, true, 'Manual retry must bypass a cached failure');

// A hung transport that ignores abort must not permanently occupy the shared check.
resetSupabaseReachabilityForTests();
mock.timers.enable({ apis: ['setTimeout'] });
let timeoutCalls = 0;
setFetch(async () => { timeoutCalls += 1; return new Promise<Response>(() => {}); });
const hungCheck = getSupabaseReachability(true);
mock.timers.tick(8000);
for (let i = 0; i < 10; i += 1) await Promise.resolve();
assert.equal(timeoutCalls, 2, 'Timed-out health check must move on to its fallback');
mock.timers.tick(8000);
assert.deepEqual(await hungCheck, { reachable: false, reason: 'server-issue' });
mock.timers.reset();
setFetch(async () => new Response('{}', { status: 200 }));
assert.equal((await getSupabaseReachability(true)).reachable, true, 'A timeout must release the shared in-flight check');

for (let i = 0; i < 35; i += 1) await getSupabaseReachability(true);
const history = JSON.parse(diagnostics.get('submerge-cloud-diagnostics') || '[]');
assert.equal(history.length, 30, 'Diagnostics must have bounded storage');
assert.ok(history.every((entry: any) => entry.endpoint === 'health' && entry.status === 200));
assert.ok(!JSON.stringify(history).includes('test-anon-key'), 'Diagnostics must not store keys');

console.log('Supabase reachability fallback, retry, timeouts, deduplication, offline hints, and diagnostics verified.');
