// Slipstream — app orchestration: boot, screen flow, race lifecycle, onboarding (test drive → skill check).
import { Game } from './game.js';
import { Input } from './input.js';
import { Audio as GameAudio } from './audio.js';
import { store } from './store.js';
import { api } from './api.js';
import { HUD } from './ui/hud.js';
import { Coach, $, $$ } from './ui/helpers.js';
import { screens } from './ui/screens.js';
import { logoMark } from './ui/icons.js';
import { VEHICLES, PAINTS } from './core/vehicles.js';
import { RACE_TRACKS, CUPS } from './core/tracks.js';
import { fieldCenter, fieldSkills, updateRating, classFor } from './core/skill.js';
import { rng, ordinal } from './core/util.js';
import { runTutorial } from './flow/tutorial.js';
import { runPlacement } from './flow/placement.js';

GameAudio.prototype.startMusicOnce = function (style) { if (!this.music || this.music.style !== style) this.startMusic(style); };
const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
const NAMES = ['Nova', 'Blitz', 'Juno', 'Rex', 'Pixel', 'Mako', 'Zephyr', 'Cinder', 'Orbit', 'Tango', 'Vesper', 'Kiko', 'Drift', 'Echo', 'Sable', 'Quill'];

class App {
  constructor() {
    this.root = $('#ui'); this.backFn = null; this.paused = false; this.raceCtl = null; this.opts = null; this.cup = null; this.lastRun = null;
    this.input = new Input(); this.audio = new GameAudio();
    this.coach = new Coach($('#coach'), $('#toast'));
    this.hud = new HUD($('#hud'));
    const settings = new Proxy({}, { get: (_, k) => store.profile.settings[k] });
    this.game = new Game($('#gl'), { input: this.input, audio: this.audio, settings });
    if (matchMedia('(pointer:coarse)').matches) this.input.device = 'touch';
    this.wire();
  }

  wire() {
    this.input.on('pause', () => {
      if (this.raceCtl && this.game.mode === 'race' && !this.finishedUi) this.paused ? this.hidePause() : this.showPause();
      else if (!this.raceCtl) this.backFn?.();
    });
    $('#tc-pause').addEventListener('click', () => this.raceCtl && (this.paused ? this.hidePause() : this.showPause()));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.raceCtl && !this.paused && this.game.mode === 'race') this.showPause(); });
    addEventListener('pointerdown', () => { this.audio.ensure(); }, { passive: true });
    addEventListener('keydown', (e) => this.menuKeys(e));
    store.on((p) => { this.applyAudio(p); this.applyControls(p); });
    addEventListener('beforeunload', () => { store.flush?.(); });
  }
  applyControls(p = store.profile) { const c = p.settings; this.input.configure({ scheme: c.controls, onscreen: c.onscreen, autoGas: c.autoGas }); }
  applyAudio(p = store.profile) { const s = p.settings; this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx }); }

  // ------------------------------------------------------------ small UI helpers
  show(html) { this.root.innerHTML = html; return this.root.firstElementChild; }
  setBack(fn) { this.backFn = fn; }
  getBack() { return this.backFn; }
  bind(el, map) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
      if (a === 'back') { this.audio.sfx('ui-back'); this.backFn?.(); } else if (map[a]) { this.audio.sfx('ui-ok'); map[a](); }
    });
  }
  menuKeys(e) {
    if (this.raceCtl && !this.paused) return;
    const tag = e.target?.tagName; if (/INPUT|TEXTAREA/.test(tag) && !['ArrowUp', 'ArrowDown'].includes(e.code)) return;
    if (tag === 'INPUT' && e.target.type === 'range') return;
    const dirs = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }; if (!(e.code in dirs)) return;
    if (/INPUT/.test(tag) && e.target.type !== 'range' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
    const scope = $('#pause') || this.root;
    const items = $$('button:not([disabled]), input.inp', scope).filter((b) => b.offsetParent !== null && !b.closest('[hidden]'));
    if (!items.length) return;
    let i = items.indexOf(document.activeElement); i = i < 0 ? 0 : (i + dirs[e.code] + items.length) % items.length;
    items[i].focus(); items[i].scrollIntoView?.({ block: 'nearest' }); this.audio.sfx('ui'); e.preventDefault();
  }

  // ------------------------------------------------------------ background scenes
  async demo() {
    if (this.game.mode === 'demo' && !this.demoBusy) return;
    if (this.demoBusy) return; this.demoBusy = true;
    try { const t = RACE_TRACKS[(Math.random() * RACE_TRACKS.length) | 0].id; await this.game.startDemo(t); this.audio.stopEngine(); } finally { this.demoBusy = false; }
  }
  demoOff() { this.demo(); }

  // ------------------------------------------------------------ entries
  makeEntry(isPlayer = true, slot = 0) {
    const p = store.profile;
    return { id: 'me', name: p.name, vehicle: p.vehicle, color: p.color, stripe: p.stripe, skill: 0.5, number: 7, isPlayer: true, slot };
  }
  buildField(skills, seed = 1) {
    const r = rng(seed * 31 + 7), p = store.profile, n = skills.length;
    const names = NAMES.slice().sort(() => r() - 0.5), paints = PAINTS.filter((c) => c.id !== p.color).sort(() => r() - 0.5);
    const slots = Array.from({ length: n + 1 }, (_, i) => i).sort(() => r() - 0.5);
    const entries = skills.map((skill, i) => ({
      id: 'ai' + i, name: names[i], vehicle: VEHICLES[Math.floor(r() * VEHICLES.length)].id, color: paints[i % paints.length].id,
      stripe: ['none', 'dual', 'chevron', 'checker'][Math.floor(r() * 4)], skill, number: i + 2, isPlayer: false, slot: slots[i],
    }));
    entries.push({ ...this.makeEntry(true, slots[n]) });
    return entries;
  }

  // ------------------------------------------------------------ race lifecycle
  playRace(cfg) {
    return new Promise(async (resolve) => {
      this.cleanupRace(false);
      this.raceCtl = { cfg, resolve }; this.finishedUi = false; this.paused = false;
      this.root.innerHTML = ''; this.setBack(null);
      this.hud.setTrack(cfg.trackId); this.hud.show(true);
      this.applyControls(); this.input.refreshOnscreen(); const touch = this.input.onscreen; document.body.classList.toggle('touchmode', touch); $('#touch').hidden = !touch; $('#touch').dataset.scheme = this.input.scheme;
      const full = {
        ...cfg,
        onFrame: (snap) => this.hud.update(snap, cfg.hud || {}),
        onEvent: (e, race) => { this.hudEvent(e, race); cfg.onEvent?.(e, race); },
        onFinish: (results, race) => {
          if (!this.raceCtl || this.raceCtl.cfg !== cfg) return;
          this.finishedUi = true; this.audio.stopEngine(); this.hud.show(false); $('#touch').hidden = true; this.coach.hide();
          const ctl = this.raceCtl; this.raceCtl = null; ctl.resolve({ results, race, cfg });
        },
      };
      try { await this.game.startRace(full); } catch (err) { console.error(err); this.cleanupRace(); resolve(null); return; }
      if (cfg.raceMode === 'placement' || cfg.raceMode === 'race' || cfg.raceMode === 'time') this.coach.toast(cfg.raceMode === 'time' ? 'Beat the clock' : 'Get ready!', 900);
      cfg.onReady?.();
    });
  }
  cleanupRace(resolveNull = true) {
    this.hud.show(false); $('#touch').hidden = true; this.coach.hide(); this.coach.onSkip = null; document.body.classList.remove('touchmode');
    $('#pause')?.remove(); this.paused = false; this.game.pause(false);
    const c = this.raceCtl; this.raceCtl = null; if (c && resolveNull) c.resolve(null);
  }
  endRace() { this.cleanupRace(true); }
  quitRace() { this.cleanupRace(true); this.cup = null; this.screenMenu(); }
  restartRace(fromResults) {
    if (fromResults) return this.lastRun?.();
    const c = this.raceCtl; if (!c) return; this.raceCtl = null; this.game.pause(false);
    this.playRace(c.cfg).then(c.resolve);
  }
  hudEvent(e, race) {
    const me = race.player; if (!me) return; const mine = e.id === me.id, h = this.hud;
    if (e.type === 'go') h.message('GO!', 'good', 900);
    else if (e.type === 'rocket' && mine) h.message('ROCKET START!', 'gold', 1400);
    else if (e.type === 'lap' && mine && race.mode !== 'tutorial') { const n = me.lapsDone + 1; if (n === race.laps) h.message('FINAL LAP', 'gold', 1800); else if (n > 1 && n < race.laps) h.message('LAP ' + n, '', 1200); }
    else if (e.type === 'finish' && mine && race.mode !== 'tutorial') h.message('FINISH!', 'gold', 3000);
    else if (e.type === 'hit' && mine) h.message('OUCH!', 'bad', 900);
    else if (e.type === 'drift-boost' && mine && e.tier >= 3) h.message('MEGA TURBO', 'gold', 800);
  }

  // ------------------------------------------------------------ flows
  afterAuth() {
    this.applyAudio(); this.applyControls();
    if (!store.profile.onboarded) this.screenGarage({ first: true }); else this.screenMenu();
  }
  async runTutorialFlow() {
    await runTutorial(this);
    store.update({ tutorialDone: true });
    this.screenIntro('placement');
  }
  async runPlacementFlow() {
    const res = await runPlacement(this, {
      onIntro: (i) => this.raceIntro(i),
      onRaceDone: (entry) => new Promise((go) => {
        const el = this.show(`<div class="screen shade-full" style="align-items:center;justify-content:center"><div class="panel modal" style="text-align:center"><div class="dim small" style="letter-spacing:.2em">RACE COMPLETE</div><div class="res-place" style="font-size:96px">${entry.place}<sup>${ordinal(entry.place).replace(/\d+/, '')}</sup></div><button class="btn primary wide" id="go">Continue</button></div></div>`);
        $('#go', el).onclick = () => { this.audio.sfx('ui-ok'); go(); }; $('#go', el).focus();
      }),
    });
    if (!res) { store.update({ placementDone: true, onboarded: true }); this.screenMenu(); return; }
    store.update({ rating: +res.rating.toFixed(3), placementDone: true, onboarded: true, tutorialDone: true });
    this.screenReveal(res);
  }

  fieldFor(difficulty) {
    const center = fieldCenter(difficulty, store.profile.rating);
    return fieldSkills(center, 7, 0.06);
  }
  // Common post-race bookkeeping → { summary, delta }
  finishRace(res, { mode, difficulty }) {
    const me = res.results.find((r) => r.isPlayer), p = store.profile;
    let ratingAfter = null, delta = null;
    if (mode !== 'time' && difficulty === 'auto' && res.results.length > 1) { ratingAfter = updateRating(p.rating, me.place, res.results.length, p.racesPlayed); delta = ratingAfter - p.rating; }
    const summary = store.recordRace({ trackId: res.cfg.trackId, results: res.results, laps: res.cfg.laps, mode, ratingAfter });
    if (store.signedIn && summary) {
      if (summary.newLap) api.score({ track: res.cfg.trackId, mode: 'lap', time: summary.bestLap, vehicle: p.vehicle });
      if (summary.newRace) api.score({ track: res.cfg.trackId, mode: 'race', laps: res.cfg.laps, time: me.time, vehicle: p.vehicle });
    }
    return { summary, delta };
  }

  async runQuick(opts) {
    const o = { ...opts };
    this.lastRun = () => this.runQuick(o);
    const entries = this.buildField(this.fieldFor(o.difficulty), (Math.random() * 1e6) | 0);
    const res = await this.playRace({ trackId: o.track, laps: o.laps, items: o.items, rubber: 0.5, entries, raceMode: 'race' });
    if (!res) return;
    const { summary, delta } = this.finishRace(res, { mode: 'quick', difficulty: o.difficulty });
    this.screenResults({ ...res, summary, delta });
  }
  async runTimeTrial(opts) {
    const o = { ...opts };
    this.lastRun = () => this.runTimeTrial(o);
    const res = await this.playRace({ trackId: o.track, laps: o.laps, items: false, rubber: 0, entries: [this.makeEntry(true, 0)], raceMode: 'time' });
    if (!res) return;
    const { summary } = this.finishRace(res, { mode: 'time', difficulty: 'none' });
    this.screenResults({ ...res, summary, delta: null });
  }
  async runCup(opts) {
    const o = { ...opts }, def = CUPS.find((c) => c.id === o.cup), seed = (Math.random() * 1e6) | 0;
    const skills = this.fieldFor(o.difficulty);
    const cup = (this.cup = { def, table: [] });
    this.lastRun = () => this.runCup(o);
    for (let i = 0; i < def.tracks.length; i++) {
      const entries = this.buildField(skills, seed);
      if (!cup.table.length) cup.table = entries.map((e) => ({ id: e.id, name: e.name, isPlayer: e.isPlayer, pts: 0, places: [], lastPlace: 0 }));
      const res = await this.playRace({ trackId: def.tracks[i], laps: o.laps, items: o.items, rubber: 0.5, entries, raceMode: 'race' });
      if (!res || this.cup !== cup) return;
      for (const r of res.results) { const row = cup.table.find((t) => t.id === r.id); if (row) { row.pts += POINTS[r.place - 1] || 0; row.places.push(r.place); row.lastPlace = r.place; } }
      const { summary, delta } = this.finishRace(res, { mode: 'gp', difficulty: o.difficulty });
      await new Promise((next) => this.screenResults({ ...res, summary, delta, gp: { raceNo: i + 1, of: def.tracks.length, next } }));
      if (this.cup !== cup) return;
    }
    this.screenCupResults(cup);
  }
}
Object.assign(App.prototype, screens);

async function boot() {
  const boot = $('#boot'); $('.boot-logo', boot).innerHTML = logoMark;
  let app;
  try { app = new App(); } catch (err) {
    console.error(err);
    boot.querySelector('.boot-in').innerHTML = '<h2 style="font-family:var(--disp)">Can’t start the game</h2><p class="dim">Slipstream needs a browser with WebGL enabled.</p>'; return;
  }
  window.slipstream = app;
  const kind = await store.restore().catch(() => null);
  app.applyAudio(); app.applyControls();
  if (kind) app.afterAuth(); else app.screenTitle();
  setTimeout(() => boot.classList.add('gone'), 450);
  setTimeout(() => boot.remove(), 1200);
}
boot();
