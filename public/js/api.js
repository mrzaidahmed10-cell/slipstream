// Thin client for the /api backend. Every call degrades gracefully when the backend is unreachable.
const TOKEN_KEY = 'slipstream.token', USER_KEY = 'slipstream.user';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

async function req(method, path, body, { timeout = 6000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  const headers = { 'Content-Type': 'application/json' };
  const tok = store.get(TOKEN_KEY); if (tok) headers.Authorization = 'Bearer ' + tok;
  try {
    const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok && !data) return { ok: false, status: r.status, error: 'Server unavailable' };
    return { ok: r.ok, status: r.status, ...(data || {}) };
  } catch { return { ok: false, status: 0, error: 'Offline' }; } finally { clearTimeout(t); }
}

export const api = {
  online: null,
  get token() { return store.get(TOKEN_KEY); },
  get username() { return store.get(USER_KEY); },
  async ping() { const r = await req('GET', '/api/ping', null, { timeout: 2500 }); this.online = !!r.ok; return this.online; },
  async signup(username, password, profile) { const r = await req('POST', '/api/signup', { username, password, profile }); if (r.ok) { store.set(TOKEN_KEY, r.token); store.set(USER_KEY, r.username); } return r; },
  async login(username, password) { const r = await req('POST', '/api/login', { username, password }); if (r.ok) { store.set(TOKEN_KEY, r.token); store.set(USER_KEY, r.username); } return r; },
  async logout() { await req('POST', '/api/logout'); store.set(TOKEN_KEY, null); store.set(USER_KEY, null); },
  async me() { return req('GET', '/api/me'); },
  async saveProfile(profile) { return req('PUT', '/api/me', { profile }); },
  async score(body) { return req('POST', '/api/score', body); },
  async leaderboard(track, mode) { return req('GET', `/api/leaderboard?track=${encodeURIComponent(track)}&mode=${mode}`); },
  clearSession() { store.set(TOKEN_KEY, null); store.set(USER_KEY, null); },
};
