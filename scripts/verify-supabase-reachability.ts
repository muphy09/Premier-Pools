import assert from 'node:assert/strict';

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
  reachable: false,
  reason: 'no-internet',
});

console.log('Supabase reachability fallback, hysteresis, deduplication, and true-offline detection verified.');
