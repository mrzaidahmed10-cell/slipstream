// Player profile: local persistence per account (or guest) plus debounced cloud sync when signed in.
import { api } from './api.js';
import { clamp } from './core/util.js';

export const DEFAULT_SETTINGS = { quality: 'medium', master: 0.8, music: 0.45, sfx: 0.9, shake: 1, laps: 3, controls: 'buttons', onscreen: 'auto', autoGas: false };
export const defaultProfile = () => ({
  name: 'Driver', vehicle: 'comet', color: 'crimson', stripe: 'dual',
  rating: 0.4, racesPlayed: 0, onboarded: false, tutorialDone: false, placementDone: false, difficulty: 'auto',
  bests: {}, cups: {}, stats: { wins: 0, podiums: 0, driftBoosts: 0, hits: 0, distance: 0 }, settings: { ...DEFAULT_SETTINGS },
});

function merge(base, p) {
  const out = { ...base, ...p };
  out.stats = { ...base.stats, ...(p && p.stats) }; out.settings = { ...base.settings, ...(p && p.settings) };
  out.bests = { ...(p && p.bests) }; out.cups = { ...(p && p.cups) };
  out.rating = clamp(+out.rating || 0.4, 0, 1);
  return out;
}
const keyFor = (u) => 'slipstream.profile.' + (u || 'guest');
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

class Store {
  constructor() { this.user = null; this.profile = defaultProfile(); this.listeners = new Set(); this.syncTimer = 0; this.syncState = 'idle'; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(this.profile); }
  get signedIn() { return !!this.user; }

  // Restore a previous session (token → server profile; guest → local profile).
  async restore() {
    const tok = api.token, u = api.username;
    if (tok && u) {
      const r = await api.me();
      if (r.ok) { this.user = r.username; this.profile = merge(defaultProfile(), r.profile); write(keyFor(this.user), this.profile); this.emit(); return 'account'; }
      if (r.status === 401) api.clearSession();
      else { // offline: use the cached copy but keep the session for later
        const cached = read(keyFor(u)); if (cached) { this.user = u; this.profile = merge(defaultProfile(), cached); this.syncState = 'offline'; this.emit(); return 'account'; }
      }
    }
    const g = read(keyFor(null));
    if (g && localStorage.getItem('slipstream.guest') === '1') { this.user = null; this.profile = merge(defaultProfile(), g); this.emit(); return 'guest'; }
    return null;
  }
  startGuest() { try { localStorage.setItem('slipstream.guest', '1'); } catch {} this.user = null; this.profile = merge(defaultProfile(), read(keyFor(null)) || {}); this.emit(); }
  async signup(username, password) {
    const local = this.user ? null : (read(keyFor(null)) ? merge(defaultProfile(), read(keyFor(null))) : this.profile);
    const r = await api.signup(username, password, local || this.profile);
    if (r.ok) { this.user = r.username; this.profile = merge(defaultProfile(), r.profile); write(keyFor(this.user), this.profile); this.emit(); }
    return r;
  }
  async login(username, password) {
    const r = await api.login(username, password);
    if (r.ok) { this.user = r.username; this.profile = merge(defaultProfile(), r.profile); write(keyFor(this.user), this.profile); this.emit(); }
    return r;
  }
  async logout() { await api.logout(); this.user = null; try { localStorage.removeItem('slipstream.guest'); } catch {} this.profile = defaultProfile(); this.emit(); }

  update(patch) {
    this.profile = merge(this.profile, patch);
    write(keyFor(this.user), this.profile);
    this.emit(); this.scheduleSync();
  }
  updateSettings(patch) { this.update({ settings: { ...this.profile.settings, ...patch } }); }

  scheduleSync() {
    if (!this.user) return;
    clearTimeout(this.syncTimer); this.syncState = 'pending';
    this.syncTimer = setTimeout(() => this.flush(), 1500);
  }
  async flush() {
    if (!this.user) return;
    const r = await api.saveProfile(this.profile);
    this.syncState = r.ok ? 'saved' : 'offline';
    if (!r.ok && r.status === 401) { api.clearSession(); this.syncState = 'expired'; }
    this.emit();
  }

  // Record the outcome of a finished race and return a summary for the results screen.
  recordRace({ trackId, results, laps, mode, ratingAfter }) {
    const p = this.profile; const me = results.find((r) => r.isPlayer); if (!me) return null;
    const bests = { ...p.bests }; const b = { ...(bests[trackId] || {}) };
    let newLap = false, newRace = false;
    if (me.bestLap && (!b.lap || me.bestLap < b.lap)) { b.lap = +me.bestLap.toFixed(3); newLap = true; }
    if (mode !== 'time' && laps === 3 && me.place === 1 && !me.estimated && (!b.race || me.time < b.race)) { b.race = +me.time.toFixed(3); newRace = true; }
    bests[trackId] = b;
    const stats = { ...p.stats };
    if (mode !== 'time') { if (me.place === 1) stats.wins++; if (me.place <= 3) stats.podiums++; }
    stats.driftBoosts += me.stats.driftBoosts; stats.hits += me.stats.hits;
    this.update({ bests, stats, racesPlayed: p.racesPlayed + (mode === 'time' ? 0 : 1), ...(ratingAfter != null ? { rating: ratingAfter } : {}) });
    return { newLap, newRace, bestLap: me.bestLap };
  }
}
export const store = new Store();
