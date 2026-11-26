// End-to-end API test against the real handler with a mock KV.
import { onRequest } from '../functions/api/[[path]].js';
import { makeKV } from './mock-kv.mjs';
const env = { SLIPSTREAM_KV: makeKV() };
let fails = 0;
const call = async (method, path, body, token, ip = '1.1.1.1') => {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }; if (token) headers.Authorization = 'Bearer ' + token;
  const r = await onRequest({ request: new Request('http://x' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env });
  return { status: r.status, body: await r.json() };
};
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); };

let r = await call('GET', '/api/ping'); ok('ping', r.status === 200 && r.body.ok);
r = await call('POST', '/api/signup', { username: 'ab', password: 'secret1' }); ok('rejects short username', r.status === 400);
r = await call('POST', '/api/signup', { username: 'zaid', password: '123' }); ok('rejects short password', r.status === 400);
r = await call('POST', '/api/signup', { username: 'Zaid', password: 'secret1', profile: { name: '<b>Zed</b>', rating: 7, vehicle: 'comet' } });
ok('signup', r.status === 200 && r.body.token?.length === 64, JSON.stringify(r.body));
ok('profile sanitised', r.body.profile.rating === 1 && !/[<>]/.test(r.body.profile.name), JSON.stringify(r.body.profile));
const token = r.body.token;
ok('password not stored in plaintext', !JSON.stringify(env.SLIPSTREAM_KV._data).includes('secret1'));
r = await call('POST', '/api/signup', { username: 'zaid', password: 'secret1' }); ok('duplicate username 409', r.status === 409);
r = await call('POST', '/api/login', { username: 'zaid', password: 'wrongpw' }); ok('wrong password 401', r.status === 401);
r = await call('POST', '/api/login', { username: 'nobody', password: 'secret1' }); ok('unknown user 401', r.status === 401);
r = await call('POST', '/api/login', { username: 'ZAID', password: 'secret1' }); ok('login (case-insensitive)', r.status === 200 && r.body.token);
r = await call('GET', '/api/me'); ok('me requires auth', r.status === 401);
r = await call('GET', '/api/me', null, token); ok('me', r.status === 200 && r.body.username === 'zaid');
r = await call('PUT', '/api/me', { profile: { name: 'Zed', rating: 0.61, onboarded: true, bests: { apex: { lap: 44.2, race: 140 } }, evil: 'x' } }, token);
ok('save profile', r.status === 200 && r.body.profile.rating === 0.61 && !('evil' in r.body.profile) && r.body.profile.bests.apex.lap === 44.2, JSON.stringify(r.body));
r = await call('POST', '/api/score', { track: 'apex', mode: 'lap', time: 5 }, token); ok('rejects impossible lap', r.status === 422);
r = await call('POST', '/api/score', { track: 'nope', mode: 'lap', time: 50 }, token); ok('rejects unknown track', r.status === 400);
r = await call('POST', '/api/score', { track: 'apex', mode: 'lap', time: 47.5, vehicle: 'comet' }, token); ok('score accepted', r.status === 200 && r.body.improved && r.body.rank === 1);
r = await call('POST', '/api/score', { track: 'apex', mode: 'lap', time: 49.0 }, token); ok('slower score not an improvement', r.status === 200 && r.body.improved === false);
const t2 = (await call('POST', '/api/signup', { username: 'racer2', password: 'hunter22' })).body.token;
await call('POST', '/api/score', { track: 'apex', mode: 'lap', time: 45.1, vehicle: 'pip' }, t2);
r = await call('GET', '/api/leaderboard?track=apex&mode=lap'); ok('leaderboard sorted', r.body.entries.length === 2 && r.body.entries[0].u === 'racer2' && r.body.entries[1].u === 'zaid', JSON.stringify(r.body));
r = await call('POST', '/api/logout', null, token); r = await call('GET', '/api/me', null, token); ok('logout invalidates session', r.status === 401);
let limited = false; for (let i = 0; i < 15; i++) { const x = await call('POST', '/api/login', { username: 'zaid', password: 'bad' + i }, null, '9.9.9.9'); if (x.status === 429) limited = true; }
ok('auth rate limit', limited);
console.log(fails ? `\n${fails} FAILED` : '\nall API tests passed'); process.exit(fails ? 1 : 0);
