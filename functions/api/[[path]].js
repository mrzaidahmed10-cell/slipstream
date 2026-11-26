// Slipstream API — Cloudflare Pages Function (catch-all under /api/*).
// Storage: one KV namespace bound as SLIPSTREAM_KV.
//   u:<username>           account { name, salt, hash, iter, created, profile }
//   s:<token>              session { u, exp }          (TTL 30 days)
//   lb:<track>:<mode>      top-50 leaderboard array     (mode: lap | race)
//   rl:<ip>:<minute>       auth rate-limit counter      (TTL 120 s)

const ENC = new TextEncoder();
const ITER = 100000; // Workers' PBKDF2 maximum
const SESSION_TTL = 60 * 60 * 24 * 30;
const TRACKS = ['apex', 'dune', 'frost', 'cove', 'redwood', 'neon'];
// Minimum plausible times (seconds) — a cheap sanity filter, not real anti-cheat.
const MIN_LAP = { apex: 30, dune: 31, frost: 38, cove: 32, redwood: 38, neon: 33 };

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const err = (status, message) => json({ error: message }, status);

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randToken = (n = 32) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); };

async function hashPassword(password, salt, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const validUser = (u) => typeof u === 'string' && /^[a-z0-9_]{3,16}$/.test(u);

// Whitelist + clamp everything coming from the client before it is stored.
function sanitizeProfile(p = {}) {
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const str = (v, n, d = '') => (typeof v === 'string' ? v.slice(0, n) : d);
  const out = {
    name: str(p.name, 16, 'Driver').replace(/[<>&"']/g, ''),
    vehicle: str(p.vehicle, 16, 'comet'), color: str(p.color, 16, 'crimson'), stripe: str(p.stripe, 16, 'none'),
    rating: num(p.rating, 0, 1, 0.4), racesPlayed: Math.floor(num(p.racesPlayed, 0, 1e6, 0)),
    onboarded: !!p.onboarded, tutorialDone: !!p.tutorialDone, placementDone: !!p.placementDone,
    difficulty: str(p.difficulty, 12, 'auto'),
    bests: {}, cups: {}, stats: {}, settings: {},
  };
  if (p.bests && typeof p.bests === 'object') for (const t of TRACKS) { const b = p.bests[t]; if (b) out.bests[t] = { lap: num(b.lap, 0, 9999, 0) || null, race: num(b.race, 0, 99999, 0) || null }; }
  if (p.cups && typeof p.cups === 'object') for (const c of ['sun', 'moon']) { const v = p.cups[c]; if (v) out.cups[c] = { best: num(v.best, 0, 999, 0), medal: str(v.medal, 8) }; }
  if (p.stats && typeof p.stats === 'object') for (const k of ['wins', 'podiums', 'driftBoosts', 'hits', 'distance']) out.stats[k] = num(p.stats[k], 0, 1e9, 0);
  if (p.settings && typeof p.settings === 'object') {
    const s = p.settings;
    out.settings = { quality: ['low', 'medium', 'high'].includes(s.quality) ? s.quality : 'medium', master: num(s.master, 0, 1, 0.8), music: num(s.music, 0, 1, 0.45), sfx: num(s.sfx, 0, 1, 0.9), shake: num(s.shake, 0, 1, 1), laps: [3, 5].includes(+s.laps) ? +s.laps : 3, controls: s.controls === 'wheel' ? 'wheel' : 'buttons', onscreen: ['auto', 'on', 'off'].includes(s.onscreen) ? s.onscreen : 'auto', autoGas: !!s.autoGas };
  }
  return out;
}

async function readBody(request) {
  try { const t = await request.text(); if (t.length > 20000) return null; return JSON.parse(t || '{}'); } catch { return null; }
}

async function rateLimit(env, request, limit = 12) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.SLIPSTREAM_KV.get(key)) || '0', 10);
  if (n >= limit) return false;
  await env.SLIPSTREAM_KV.put(key, String(n + 1), { expirationTtl: 120 });
  return true;
}

async function auth(env, request) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const s = await env.SLIPSTREAM_KV.get(`s:${token}`, 'json');
  if (!s || s.exp < Date.now()) return null;
  return { token, user: s.u };
}

async function newSession(env, user) {
  const token = randToken(32);
  await env.SLIPSTREAM_KV.put(`s:${token}`, JSON.stringify({ u: user, exp: Date.now() + SESSION_TTL * 1000 }), { expirationTtl: SESSION_TTL });
  return token;
}

export async function onRequest({ request, env }) {
  if (!env.SLIPSTREAM_KV) return err(500, 'KV namespace SLIPSTREAM_KV is not bound');
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const m = request.method;
  try {
    if (path === 'ping') return json({ ok: true, v: 1 });

    if (path === 'signup' && m === 'POST') {
      if (!(await rateLimit(env, request))) return err(429, 'Too many attempts. Try again in a minute.');
      const b = await readBody(request); if (!b) return err(400, 'Bad request');
      const user = String(b.username || '').toLowerCase().trim();
      if (!validUser(user)) return err(400, 'Username must be 3–16 characters: letters, numbers, underscore.');
      if (typeof b.password !== 'string' || b.password.length < 6 || b.password.length > 100) return err(400, 'Password must be at least 6 characters.');
      if (await env.SLIPSTREAM_KV.get(`u:${user}`)) return err(409, 'That username is taken.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const profile = sanitizeProfile({ ...(b.profile || {}), name: (b.profile && b.profile.name) || user });
      const rec = { name: user, salt: b64(salt), hash: await hashPassword(b.password, salt), iter: ITER, created: Date.now(), profile };
      await env.SLIPSTREAM_KV.put(`u:${user}`, JSON.stringify(rec));
      return json({ token: await newSession(env, user), username: user, profile });
    }

    if (path === 'login' && m === 'POST') {
      if (!(await rateLimit(env, request))) return err(429, 'Too many attempts. Try again in a minute.');
      const b = await readBody(request); if (!b) return err(400, 'Bad request');
      const user = String(b.username || '').toLowerCase().trim();
      const rec = validUser(user) ? await env.SLIPSTREAM_KV.get(`u:${user}`, 'json') : null;
      // always do the hash work so timing doesn't reveal whether the user exists
      const salt = rec ? unb64(rec.salt) : new Uint8Array(16);
      const h = await hashPassword(String(b.password || ''), salt, rec ? rec.iter : ITER);
      if (!rec || !safeEqual(h, rec.hash)) return err(401, 'Wrong username or password.');
      return json({ token: await newSession(env, user), username: user, profile: rec.profile });
    }

    if (path === 'logout' && m === 'POST') {
      const a = await auth(env, request); if (a) await env.SLIPSTREAM_KV.delete(`s:${a.token}`);
      return json({ ok: true });
    }

    if (path === 'me') {
      const a = await auth(env, request); if (!a) return err(401, 'Not signed in');
      const rec = await env.SLIPSTREAM_KV.get(`u:${a.user}`, 'json'); if (!rec) return err(401, 'Account not found');
      if (m === 'GET') return json({ username: a.user, profile: rec.profile });
      if (m === 'PUT') {
        const b = await readBody(request); if (!b || !b.profile) return err(400, 'Bad request');
        rec.profile = sanitizeProfile(b.profile);
        await env.SLIPSTREAM_KV.put(`u:${a.user}`, JSON.stringify(rec));
        return json({ ok: true, profile: rec.profile });
      }
    }

    if (path === 'score' && m === 'POST') {
      const a = await auth(env, request); if (!a) return err(401, 'Not signed in');
      const b = await readBody(request); if (!b) return err(400, 'Bad request');
      const track = String(b.track || ''), mode = b.mode === 'race' ? 'race' : 'lap', t = +b.time;
      if (!TRACKS.includes(track) || !Number.isFinite(t)) return err(400, 'Bad score');
      const min = MIN_LAP[track] * (mode === 'race' ? (+b.laps === 5 ? 5 : 3) : 1);
      if (t < min || t > 3600) return err(422, 'Score rejected');
      const key = `lb:${track}:${mode}`;
      const list = (await env.SLIPSTREAM_KV.get(key, 'json')) || [];
      const prev = list.find((e) => e.u === a.user);
      if (prev && prev.t <= t) return json({ ok: true, improved: false });
      const rec = await env.SLIPSTREAM_KV.get(`u:${a.user}`, 'json');
      const entry = { u: a.user, n: (rec && rec.profile.name) || a.user, t: Math.round(t * 1000) / 1000, v: String(b.vehicle || '').slice(0, 16), d: Date.now() };
      const next = list.filter((e) => e.u !== a.user).concat(entry).sort((x, y) => x.t - y.t).slice(0, 50);
      await env.SLIPSTREAM_KV.put(key, JSON.stringify(next));
      return json({ ok: true, improved: true, rank: next.findIndex((e) => e.u === a.user) + 1 });
    }

    if (path === 'leaderboard' && m === 'GET') {
      const track = url.searchParams.get('track') || 'apex', mode = url.searchParams.get('mode') === 'race' ? 'race' : 'lap';
      if (!TRACKS.includes(track)) return err(400, 'Unknown track');
      const list = (await env.SLIPSTREAM_KV.get(`lb:${track}:${mode}`, 'json')) || [];
      return json({ track, mode, entries: list.slice(0, 25) });
    }

    return err(404, 'Not found');
  } catch (e) {
    return err(500, 'Server error');
  }
}
