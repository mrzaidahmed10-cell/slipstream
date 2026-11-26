// All menu screens. Mixed into App.prototype; each screen renders into #ui and wires its own events.
import { $, $$, esc, stars } from './helpers.js';
import { ICON, ITEM_ICONS, logoMark } from './icons.js';
import { trackThumb } from './thumbs.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { VEHICLES, PAINTS, STRIPES, PAINT_BY_ID, VEHICLE_BY_ID } from '../core/vehicles.js';
import { RACE_TRACKS, CUPS, TRACK_DEFS } from '../core/tracks.js';
import { CLASSES, DIFFICULTIES, classFor } from '../core/skill.js';
import { ITEM_INFO } from '../core/race.js';
import { keyHints } from '../input.js';
import { fmtTime, ordinal } from '../core/util.js';

const trackName = (id) => TRACK_DEFS.find((t) => t.id === id)?.name || id;
const logo = (extra = '') => `<div class="logo">${logoMark}<div>Slipstream<small>${extra || 'KART RACING'}</small></div></div>`;
const back = (label = 'Back') => `<button class="back" data-act="back" aria-label="${label}">${ICON.back}</button>`;
const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export const screens = {
  // ---------------------------------------------------------------- title / sign in
  async screenTitle() {
    this.setBack(null);
    this.demo();
    const el = this.show(`<div class="screen shade title-wrap">
      <div class="row">${logo()}<span class="grow"></span><span class="chip" id="net"><i class="dot"></i><span>Connecting…</span></span></div>
      <div class="title-main">
        <h1>Drift. Boost.<br>Slipstream.</h1>
        <p class="dim">Six tracks, six items and rivals that learn how fast <em>you</em> are. Your first stop is a short test drive.</p>
        <form class="panel auth" id="auth" autocomplete="on">
          <div class="tabs"><button type="button" data-mode="signup" class="on">Create account</button><button type="button" data-mode="login">Sign in</button></div>
          <div class="field"><label for="u">Username</label><input class="inp" id="u" name="username" autocomplete="username" maxlength="16" placeholder="3–16 letters, numbers, _" spellcheck="false" autocapitalize="off"></div>
          <div class="field"><label for="p">Password</label><input class="inp" id="p" name="password" type="password" autocomplete="new-password" maxlength="72" placeholder="At least 8 characters"></div>
          <div class="err" id="err" role="alert"></div>
          <button class="btn primary wide" id="go">Create account</button>
          <button type="button" class="btn ghost wide" id="guest">Play as guest</button>
          <div class="tiny dim" id="gnote">Guest progress is saved on this device only.</div>
        </form>
      </div>
      <div class="title-foot"><span>Keyboard · Gamepad · Touch</span><span>v1.0</span></div></div>`);
    let mode = 'signup';
    const setMode = (m) => { mode = m; $$('.tabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.mode === m)); $('#go', el).textContent = m === 'signup' ? 'Create account' : 'Sign in'; $('#p', el).autocomplete = m === 'signup' ? 'new-password' : 'current-password'; $('#err', el).textContent = ''; };
    $$('.tabs button', el).forEach((b) => (b.onclick = () => { this.audio.sfx('ui'); setMode(b.dataset.mode); }));
    api.ping().then((ok) => { const n = $('#net', el); if (!n) return; n.innerHTML = `<i class="dot ${ok ? 'on' : 'off'}"></i><span>${ok ? 'Online' : 'Offline'}</span>`; if (!ok) $('#gnote', el).textContent = 'Server unreachable — you can still play as a guest.'; });
    $('#auth', el).onsubmit = async (e) => {
      e.preventDefault(); const btn = $('#go', el), err = $('#err', el); err.textContent = '';
      const u = $('#u', el).value.trim(), p = $('#p', el).value;
      if (!/^[A-Za-z0-9_]{3,16}$/.test(u)) return (err.textContent = 'Username must be 3–16 letters, numbers or underscores.');
      if (p.length < 8) return (err.textContent = 'Password must be at least 8 characters.');
      btn.disabled = true; btn.textContent = '…';
      const r = mode === 'signup' ? await store.signup(u, p) : await store.login(u, p);
      btn.disabled = false; btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
      if (!r.ok) return (err.textContent = r.error || 'Something went wrong.');
      this.audio.sfx('ui-ok');
      if (mode === 'signup' && store.profile.name === 'Driver') store.update({ name: u });
      this.afterAuth();
    };
    $('#guest', el).onclick = () => { this.audio.sfx('ui-ok'); store.startGuest(); this.afterAuth(); };
    setTimeout(() => $('#u', el)?.focus(), 400);
  },

  // ---------------------------------------------------------------- garage (also first-run setup)
  async screenGarage({ first = false } = {}) {
    const p = store.profile;
    const sel = { vehicle: p.vehicle, color: p.color, stripe: p.stripe, number: 7 };
    let name = p.name;
    this.setBack(first ? null : () => this.screenMenu());
    this.demoOff();
    const el = this.show(`<div class="screen garage">
      <div class="side">
        <div class="top">${first ? '' : back()}<div><h2>${first ? 'Build your ride' : 'Garage'}</h2><div class="dim small">${first ? 'Pick a driver name and a vehicle. You can change these any time.' : 'Choose a vehicle and paint.'}</div></div></div>
        <div class="field"><label for="nm">Driver name</label><input class="inp" id="nm" maxlength="14" value="${esc(name)}" spellcheck="false"></div>
        <div><div class="sect">Vehicle</div><div class="vlist" id="vl"></div></div>
        <div class="panel pad col" style="gap:10px"><div class="dim small" id="vb"></div><div class="stats" id="st"></div></div>
        <div><div class="sect">Paint</div><div class="swatches" id="sw"></div></div>
        <div><div class="sect">Livery</div><div class="opts" id="lv"></div></div>
        <button class="btn primary wide" id="done">${first ? 'Continue' : 'Save'}</button>
      </div>
      <div class="stage"><div class="vname"><h1 id="vn"></h1><div class="dim" id="vt"></div></div></div></div>`);
    await this.game.showGarage(sel);
    const draw = () => {
      const v = VEHICLE_BY_ID[sel.vehicle];
      $('#vl', el).innerHTML = VEHICLES.map((x) => `<button class="vbtn ${x.id === sel.vehicle ? 'on' : ''}" data-v="${x.id}">${esc(x.name)}<small>${x.type}</small></button>`).join('');
      $('#vb', el).textContent = v.blurb;
      $('#st', el).innerHTML = Object.entries(v.stats).map(([k, val]) => `<div class="stat"><span>${k}</span><div class="bar"><i style="width:${val * 100}%"></i></div></div>`).join('');
      $('#sw', el).innerHTML = PAINTS.map((c) => `<button class="sw ${c.id === sel.color ? 'on' : ''}" data-c="${c.id}" style="background:${c.color}" aria-label="${c.name}" title="${c.name}"></button>`).join('');
      $('#lv', el).innerHTML = STRIPES.map((s) => `<button class="opt ${s.id === sel.stripe ? 'on' : ''}" data-s="${s.id}">${s.name}</button>`).join('');
      $('#vn', el).textContent = v.name; $('#vt', el).textContent = (v.type === 'car' ? 'Small car' : 'Kart') + ' · ' + PAINT_BY_ID[sel.color].name;
      this.game.garageSet(sel);
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.v) sel.vehicle = b.dataset.v; else if (b.dataset.c) sel.color = b.dataset.c; else if (b.dataset.s) sel.stripe = b.dataset.s; else return;
      this.audio.sfx('ui'); draw();
    });
    $('#done', el).onclick = () => {
      this.audio.sfx('ui-ok'); name = $('#nm', el).value.trim().slice(0, 14) || 'Driver';
      store.update({ name, vehicle: sel.vehicle, color: sel.color, stripe: sel.stripe });
      first ? this.screenIntro('tutorial') : this.screenMenu();
    };
    draw();
  },

  // ---------------------------------------------------------------- intros for the onboarding flow
  screenIntro(kind) {
    this.setBack(null); this.demo();
    const tut = kind === 'tutorial';
    const el = this.show(`<div class="screen shade-full" style="align-items:center;justify-content:center">
      <div class="panel modal big" style="gap:14px">
        <div class="chip" style="align-self:flex-start">STEP ${tut ? 1 : 2} OF 2</div>
        <h2>${tut ? 'Test drive' : 'Skill check'}</h2>
        <p class="dim" style="margin:0">${tut
          ? 'A closed course with no rivals. You’ll learn to accelerate, steer, brake, drift for turbo boosts, hit boost pads and use items. About two minutes.'
          : 'Two or three short races against a ladder of AI drivers, from slow to fast. Where you finish tells us how strong you are, so every race after this is a good fight. Just drive your best.'}</p>
        <button class="btn primary wide" id="go">${tut ? 'Start test drive' : 'Start skill check'}</button>
        <button class="btn ghost wide" id="skip">${tut ? 'I know how to play — skip' : 'Skip — start me at Pro'}</button>
      </div></div>`);
    $('#go', el).onclick = () => { this.audio.sfx('ui-ok'); tut ? this.runTutorialFlow() : this.runPlacementFlow(); };
    $('#skip', el).onclick = () => {
      this.audio.sfx('ui');
      if (tut) { store.update({ tutorialDone: true }); this.screenIntro('placement'); }
      else { store.update({ placementDone: true, onboarded: true, rating: 0.45 }); this.screenMenu(); }
    };
  },
  raceIntro({ index, total, trackId }) {
    return new Promise((res) => {
      this.setBack(null);
      const el = this.show(`<div class="screen shade-full" style="align-items:center;justify-content:center"><div class="panel modal">
        <div class="chip" style="align-self:flex-start">SKILL CHECK · RACE ${index + 1}${index === 0 ? '' : ''}</div>
        <img src="${trackThumb(trackId)}" style="width:100%;border-radius:12px" alt="">
        <h2>${esc(trackName(trackId))}</h2><p class="dim" style="margin:0">2 laps. ${index === 0 ? 'A wide field of rivals — just race.' : 'The field is now tuned closer to your level.'}</p>
        <button class="btn primary wide" id="go">Go!</button><button class="btn ghost wide" id="skip">Stop skill check</button></div></div>`);
      $('#go', el).onclick = () => { this.audio.sfx('ui-ok'); res('go'); };
      $('#skip', el).onclick = () => res('skip');
    });
  },
  screenReveal(res) {
    this.setBack(null); this.demo();
    const cls = res.cls, idx = CLASSES.indexOf(cls);
    const el = this.show(`<div class="screen shade-full reveal">
      <div class="dim" style="letter-spacing:.3em">YOUR CLASS</div>
      <div class="cls" style="color:${cls.color};text-shadow:0 0 60px ${cls.color}88">${cls.name}</div>
      <div class="ladder">${CLASSES.map((c, i) => `<i style="${i <= idx ? 'background:' + c.color : ''}"></i>`).join('')}</div>
      <p class="dim" style="max-width:420px;margin:0">Rivals will start around <b style="color:#fff">${cls.name}</b> level and keep adapting as you win and lose. You can change difficulty any time.</p>
      <button class="btn primary" id="go" style="min-width:240px">Start racing</button></div>`);
    this.audio.sfx('finish');
    $('#go', el).onclick = () => { this.audio.sfx('ui-ok'); this.screenMenu(); };
  },

  // ---------------------------------------------------------------- main menu
  screenMenu() {
    this.setBack(null);
    const p = store.profile, cls = classFor(p.rating), paint = PAINT_BY_ID[p.color] || PAINTS[0];
    this.demo();
    const sync = store.signedIn ? ({ saved: 'Saved', pending: 'Saving…', offline: 'Offline', expired: 'Session expired', idle: 'Synced' }[store.syncState] || 'Synced') : 'Guest';
    const el = this.show(`<div class="screen shade menu-wrap">
      <div class="menu-left">
        ${logo()}
        <div class="panel profile"><div class="avatar" style="background:${paint.color}">${esc((p.name || 'D')[0].toUpperCase())}</div>
          <div><b style="font:700 17px var(--disp)">${esc(p.name)}</b><div class="tiny dim">${store.signedIn ? '@' + esc(store.user) + ' · ' + sync : 'Guest · saved on this device'}</div></div>
          <div class="rank-badge"><b style="color:${cls.color}">${cls.name}</b><div class="ratebar"><i style="width:${Math.round(p.rating * 100)}%;background:${cls.color}"></i></div></div></div>
        <div class="menu-list">
          <button class="mitem hero" data-act="quick">${ICON.flag}<div><b>Quick race</b><span>Pick a track · 8 karts · adaptive rivals</span></div></button>
          <div class="menu-grid">
            <button class="mitem" data-act="gp">${ICON.trophy}<div><b>Grand Prix</b></div></button>
            <button class="mitem" data-act="time">${ICON.clock}<div><b>Time trial</b></div></button>
            <button class="mitem" data-act="garage">${ICON.wrench}<div><b>Garage</b></div></button>
            <button class="mitem" data-act="records">${ICON.board}<div><b>Records</b></div></button>
            <button class="mitem" data-act="help">${ICON.help}<div><b>How to play</b></div></button>
            <button class="mitem" data-act="settings">${ICON.gear}<div><b>Settings</b></div></button>
          </div>
        </div>
        <div class="menu-foot">${store.signedIn ? '<button class="btn sm ghost" data-act="logout">Sign out</button>' : '<button class="btn sm ghost" data-act="signup">Create account to save online</button>'}</div>
      </div></div>`);
    this.audio.startMusicOnce('menu');
    this.bind(el, { quick: () => this.screenSetup('quick'), gp: () => this.screenSetup('gp'), time: () => this.screenSetup('time'), garage: () => this.screenGarage(), records: () => this.screenRecords(), help: () => this.screenHelp(), settings: () => this.screenSettings(),
      logout: async () => { await store.logout(); this.screenTitle(); }, signup: () => this.screenTitle() });
    $('.mitem.hero', el).focus();
  },

  // ---------------------------------------------------------------- race setup (quick / time trial / grand prix)
  screenSetup(mode) {
    this.setBack(() => this.screenMenu());
    const p = store.profile;
    const opts = this.opts ||= { laps: p.settings.laps || 3, difficulty: p.difficulty || 'auto', items: true, track: 'apex', cup: 'sun' };
    opts.difficulty = opts.difficulty || 'auto';
    const title = { quick: 'Quick race', time: 'Time trial', gp: 'Grand Prix' }[mode];
    this.demoOff();
    const el = this.show(`<div class="screen shade-full">
      <div class="top">${back()}<div><h2>${title}</h2><div class="dim small">${{ quick: 'Choose a track.', time: 'Just you and the clock. Chase a personal best.', gp: 'Three races, one cup. Points decide the champion.' }[mode]}</div></div></div>
      <div id="pick"></div>
      <div class="row wrap" style="gap:22px;margin:18px 0 90px" id="opts"></div>
      <div style="position:sticky;bottom:0;padding-top:14px;margin-top:auto;background:linear-gradient(0deg,rgba(5,8,20,.95) 60%,transparent)"><button class="btn primary wide" id="go" style="max-width:420px">Start</button></div></div>`);
    const draw = () => {
      if (mode === 'gp') {
        $('#pick', el).innerHTML = `<div class="grid-tracks" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${CUPS.map((c) => `<button class="tcard ${opts.cup === c.id ? 'sel' : ''}" data-cup="${c.id}"><div style="display:grid;grid-template-columns:repeat(3,1fr)">${c.tracks.map((t) => `<img src="${trackThumb(t, 240, 150)}" alt="" style="aspect-ratio:8/5">`).join('')}</div><div class="tb"><b>${c.name}</b><span class="dim small">${c.tracks.map(trackName).join(' · ')}</span></div></button>`).join('')}</div>`;
      } else {
        $('#pick', el).innerHTML = `<div class="grid-tracks">${RACE_TRACKS.map((t) => {
          const b = p.bests[t.id] || {};
          return `<button class="tcard ${opts.track === t.id ? 'sel' : ''}" data-track="${t.id}"><img src="${trackThumb(t.id)}" alt="" loading="lazy"><div class="tb"><div class="row"><b>${esc(t.name)}</b><span class="grow"></span>${stars(t.difficulty)}</div><div class="dim small">${esc(t.blurb)}</div>${b.lap ? `<div class="tiny" style="margin-top:6px;color:var(--gold)">BEST LAP ${fmtTime(b.lap)}</div>` : ''}</div></button>`;
        }).join('')}</div>`;
      }
      const o = [];
      o.push(`<div><div class="sect">Laps</div><div class="opts">${[3, 5].map((n) => `<button class="opt ${opts.laps === n ? 'on' : ''}" data-laps="${n}">${n} laps</button>`).join('')}</div></div>`);
      if (mode !== 'time') {
        o.push(`<div><div class="sect">Rival difficulty</div><div class="opts">${DIFFICULTIES.map((d) => `<button class="opt ${opts.difficulty === d.id ? 'on' : ''}" data-diff="${d.id}">${d.name}${d.id === 'auto' ? `<small>${classFor(p.rating).name}</small>` : ''}</button>`).join('')}</div><div class="tiny dim" style="margin-top:6px">${DIFFICULTIES.find((d) => d.id === opts.difficulty).blurb}</div></div>`);
        o.push(`<div><div class="sect">Items</div><div class="opts"><button class="opt ${opts.items ? 'on' : ''}" data-items="1">On</button><button class="opt ${!opts.items ? 'on' : ''}" data-items="0">Off</button></div></div>`);
      }
      $('#opts', el).innerHTML = o.join('');
      $('#go', el).textContent = mode === 'gp' ? 'Start cup' : 'Start race';
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-track],[data-cup],[data-laps],[data-diff],[data-items]'); if (!b) return;
      const d = b.dataset; if (d.track) opts.track = d.track; if (d.cup) opts.cup = d.cup; if (d.laps) opts.laps = +d.laps; if (d.diff) opts.difficulty = d.diff; if (d.items != null) opts.items = d.items === '1';
      this.audio.sfx('ui'); draw();
    });
    $('#go', el).onclick = () => { this.audio.sfx('ui-ok'); store.update({ difficulty: opts.difficulty }); mode === 'gp' ? this.runCup(opts) : mode === 'time' ? this.runTimeTrial(opts) : this.runQuick(opts); };
    draw();
  },

  // ---------------------------------------------------------------- pause
  showPause() {
    if (this.paused) return; this.paused = true; this.game.pause(true);
    const wrap = document.createElement('div'); wrap.className = 'overlay'; wrap.id = 'pause';
    wrap.innerHTML = `<div class="panel modal"><h2>Paused</h2>
      <button class="btn primary wide" data-p="resume">Resume</button>
      <button class="btn wide" data-p="respawn">Respawn on track</button>
      <button class="btn wide" data-p="restart">Restart race</button>
      <button class="btn ghost wide" data-p="quit">Quit to menu</button>
      <div class="tiny dim" style="text-align:center">${(() => { const k = keyHints(this.input.device); return `Drift <kbd>${k.drift}</kbd> · Item <kbd>${k.item}</kbd> · Respawn <kbd>${k.reset}</kbd>`; })()}</div></div>`;
    this.root.appendChild(wrap);
    this.pauseBack = this.getBack(); this.setBack(() => this.hidePause());
    wrap.onclick = (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return; this.audio.sfx('ui');
      const a = b.dataset.p;
      if (a === 'resume') this.hidePause();
      else if (a === 'respawn') { this.hidePause(); this.input.resetFlag = true; }
      else if (a === 'restart') { this.hidePause(); this.restartRace(); }
      else if (a === 'quit') { this.hidePause(); this.quitRace(); }
    };
    $('[data-p=resume]', wrap).focus();
  },
  hidePause() { const w = $('#pause'); if (w) w.remove(); this.paused = false; this.game.pause(false); this.setBack(this.pauseBack || null); },

  // ---------------------------------------------------------------- results
  screenResults({ results, cfg, summary, delta, gp, ratingNow, coachNote }) {
    const me = results.find((r) => r.isPlayer);
    const el = this.show(`<div class="screen shade res-wrap">
      <div class="res-main">
        <div class="res-head">${cfg.raceMode === 'time' ? '<div class="res-place" style="font-size:54px;line-height:1">TIME<br>TRIAL</div>' : `<div class="res-place">${me.place}<sup>${ordinal(me.place).replace(/\d+/, '')}</sup></div>`}
          <div class="col" style="gap:6px;padding-bottom:6px"><div class="dim small" style="letter-spacing:.14em">${esc(trackName(cfg.trackId)).toUpperCase()}${gp ? ' · RACE ' + gp.raceNo + ' OF ' + gp.of : ''}</div>
            <div style="font:700 26px var(--disp)">${fmtTime(me.time)}</div>
            <div class="row wrap" style="gap:8px">${me.bestLap ? `<span class="chip">BEST LAP ${fmtTime(me.bestLap)}</span>` : ''}${summary?.newLap ? '<span class="badge">★ NEW PERSONAL BEST LAP</span>' : ''}${summary?.newRace ? '<span class="badge">★ NEW BEST RACE</span>' : ''}
            ${delta != null && Math.abs(delta) >= 0.002 ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} Skill ${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}</span>` : ''}</div></div></div>
        <div class="panel table">${results.map((r) => `<div class="r ${r.isPlayer ? 'me' : ''}"><b>${r.place}</b><i class="sw2" style="background:${(PAINT_BY_ID[r.color] || { color: '#999' }).color}"></i><span>${esc(r.name)}</span><span class="t">${r.time != null && !r.estimated ? fmtTime(r.time) : r.time != null ? '~' + fmtTime(r.time) : '—'}${gp ? ` · +${POINTS[r.place - 1] || 0}` : ''}</span></div>`).join('')}</div>
        ${coachNote ? `<div class="dim small">${coachNote}</div>` : ''}
        <div class="row wrap">${gp ? `<button class="btn primary" data-act="next">${gp.raceNo < gp.of ? 'Next race' : 'See cup results'}</button>` : `<button class="btn primary" data-act="again">Race again</button>`}<button class="btn" data-act="menu">Menu</button></div>
      </div></div>`);
    this.setBack(null);
    this.bind(el, { again: () => this.restartRace(true), next: () => gp.next(), menu: () => { gp ? this.cup = null : 0; this.screenMenu(); } });
    $('.btn.primary', el).focus();
  },
  screenCupResults(cup) {
    const rows = cup.table.slice().sort((a, b) => b.pts - a.pts || a.lastPlace - b.lastPlace);
    const me = rows.findIndex((r) => r.isPlayer) + 1;
    const el = this.show(`<div class="screen shade-full" style="align-items:center"><div class="res-main" style="max-width:560px;width:100%">
      <div class="dim" style="letter-spacing:.24em;text-align:center">${esc(cup.def.name.toUpperCase())}</div>
      <div style="text-align:center"><div class="res-place" style="display:inline-block">${me}<sup>${ordinal(me).replace(/\d+/, '')}</sup></div><h2>${me === 1 ? 'Cup champion!' : me <= 3 ? 'On the podium' : 'Cup complete'}</h2></div>
      <div class="panel table cup-rows">${rows.map((r, i) => `<div class="r ${r.isPlayer ? 'me' : ''}"><b>${i + 1}</b><span>${esc(r.name)}</span><span class="dim small">${r.places.map((x) => ordinal(x)).join(' · ')}</span><span class="t" style="color:#fff">${r.pts} pts</span></div>`).join('')}</div>
      <button class="btn primary" data-act="menu" style="align-self:center">Back to menu</button></div></div>`);
    this.audio.sfx(me <= 3 ? 'finish' : 'lap'); this.setBack(null);
    this.bind(el, { menu: () => { this.cup = null; this.screenMenu(); } });
  },

  // ---------------------------------------------------------------- records
  async screenRecords() {
    this.setBack(() => this.screenMenu()); this.demoOff();
    const st = (this.recState ||= { track: 'apex', mode: 'lap' });
    const el = this.show(`<div class="screen shade-full"><div class="top">${back()}<div><h2>Records</h2><div class="dim small">Best times worldwide, plus your own.</div></div></div>
      <div class="row wrap" style="gap:16px"><div class="opts" id="rt"></div></div>
      <div class="row wrap" style="gap:18px;align-items:flex-start;margin-top:14px"><div class="col grow" style="min-width:280px;max-width:640px"><div class="tabs" id="rm" style="max-width:340px"><button data-m="lap">Best lap</button><button data-m="race">3-lap race</button></div><div class="panel lb" id="lb"></div></div>
      <div class="panel pad col" style="min-width:240px" id="me"></div></div></div>`);
    const p = store.profile;
    const draw = async () => {
      $('#rt', el).innerHTML = RACE_TRACKS.map((t) => `<button class="opt ${st.track === t.id ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('');
      $$('#rm button', el).forEach((b) => b.classList.toggle('on', b.dataset.m === st.mode));
      const b = p.bests[st.track] || {};
      $('#me', el).innerHTML = `<h3>Your bests</h3><div class="stat" style="grid-template-columns:90px 1fr"><span>Best lap</span><b style="color:var(--gold)">${b.lap ? fmtTime(b.lap) : '—'}</b></div><div class="stat" style="grid-template-columns:90px 1fr"><span>3-lap race</span><b style="color:var(--gold)">${b.race ? fmtTime(b.race) : '—'}</b></div><hr style="border:0;border-top:1px solid var(--line);width:100%"><div class="dim small">Wins <b style="color:#fff">${p.stats.wins}</b> · Podiums <b style="color:#fff">${p.stats.podiums}</b> · Races <b style="color:#fff">${p.racesPlayed}</b><br>Drift boosts <b style="color:#fff">${p.stats.driftBoosts}</b></div>`;
      const lb = $('#lb', el); lb.innerHTML = '<div class="empty">Loading…</div>';
      const my = ++this.recTok; const r = await api.leaderboard(st.track, st.mode);
      if (my !== this.recTok || !$('#lb')) return;
      if (!r.ok) lb.innerHTML = '<div class="empty">Leaderboards are offline right now.</div>';
      else if (!r.entries.length) lb.innerHTML = '<div class="empty">No times yet — be the first.</div>';
      else lb.innerHTML = r.entries.map((e, i) => `<div class="r ${e.u === store.user ? 'me' : ''}"><b>${i + 1}</b><span>${esc(e.n)} <span class="dim tiny">@${esc(e.u)}</span></span><span class="t">${fmtTime(e.t)}</span></div>`).join('');
    };
    this.recTok = (this.recTok || 0);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-t],[data-m]'); if (!b) return; if (b.dataset.t) st.track = b.dataset.t; if (b.dataset.m) st.mode = b.dataset.m; this.audio.sfx('ui'); draw(); });
    this.bind(el, {});
    draw();
  },

  // ---------------------------------------------------------------- settings
  screenSettings() {
    this.setBack(() => this.screenMenu()); this.demoOff();
    const s = store.profile.settings;
    const el = this.show(`<div class="screen shade-full"><div class="top">${back()}<h2>Settings</h2></div>
      <div class="panel pad" style="max-width:640px;width:100%">
        <div class="srow"><div><b>Graphics quality</b><div class="tiny dim">Lower if the game stutters.</div></div><div class="opts" id="q">${['low', 'medium', 'high'].map((q) => `<button class="opt ${s.quality === q ? 'on' : ''}" data-q="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div></div>
        ${[['master', 'Master volume'], ['music', 'Music'], ['sfx', 'Sound effects']].map(([k, l]) => `<div class="srow"><b>${l}</b><input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-vol="${k}" aria-label="${l}"></div>`).join('')}
        <div class="srow"><b>Camera shake</b><input type="range" min="0" max="1.5" step="0.1" value="${s.shake}" data-shake aria-label="Camera shake"></div>
        <div class="srow"><div><b>Default rival difficulty</b></div><div class="opts" id="df">${DIFFICULTIES.map((d) => `<button class="opt ${store.profile.difficulty === d.id ? 'on' : ''}" data-d="${d.id}">${d.name}</button>`).join('')}</div></div>
        <div class="srow"><div><b>Skill check</b><div class="tiny dim">Retake the calibration races to reset your rating (${classFor(store.profile.rating).name}).</div></div><button class="btn sm" data-act="retake">Retake</button></div>
        <div class="srow"><div><b>Test drive</b><div class="tiny dim">Replay the tutorial.</div></div><button class="btn sm" data-act="tut">Replay</button></div>
        <div class="srow"><div><b>Account</b><div class="tiny dim">${store.signedIn ? 'Signed in as @' + esc(store.user) + ' — progress syncs online.' : 'Guest — progress stays on this device.'}</div></div><button class="btn sm" data-act="acct">${store.signedIn ? 'Sign out' : 'Create account'}</button></div>
      </div></div>`);
    el.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]'); if (q) { store.updateSettings({ quality: q.dataset.q }); this.game.applyQuality(); $$('#q .opt', el).forEach((b) => b.classList.toggle('on', b === q)); this.audio.sfx('ui'); }
      const d = e.target.closest('[data-d]'); if (d) { store.update({ difficulty: d.dataset.d }); if (this.opts) this.opts.difficulty = d.dataset.d; $$('#df .opt', el).forEach((b) => b.classList.toggle('on', b === d)); this.audio.sfx('ui'); }
    });
    el.addEventListener('input', (e) => {
      const v = e.target.dataset.vol; if (v) { store.updateSettings({ [v]: +e.target.value }); this.audio.setVolumes({ [v]: +e.target.value }); }
      if ('shake' in e.target.dataset) store.updateSettings({ shake: +e.target.value });
    });
    el.addEventListener('change', (e) => { if (e.target.dataset.vol === 'sfx') this.audio.sfx('ui-ok'); });
    this.bind(el, { retake: () => this.screenIntro('placement'), tut: () => { this.screenIntro('tutorial'); }, acct: async () => { if (store.signedIn) await store.logout(); this.screenTitle(); } });
  },

  // ---------------------------------------------------------------- how to play
  screenHelp() {
    this.setBack(() => this.screenMenu()); this.demoOff();
    const k = keyHints(this.input.device), kb = keyHints('keyboard'), pad = keyHints('gamepad');
    const itemDesc = { turbo: 'Instant speed boost.', triple: 'Three boosts — use them one at a time.', oil: 'Drop a slick behind you; rivals who hit it spin out.', mine: 'Leave a mine on the road.', seeker: 'Homing pod that chases the kart ahead.', shield: 'Absorbs one hit.' };
    const el = this.show(`<div class="screen shade-full"><div class="top">${back()}<h2>How to play</h2></div>
      <div class="help-grid">
        <div class="panel"><h3>Controls</h3><div class="small col" style="gap:6px"><div>Accelerate <kbd>${kb.accel}</kbd></div><div>Steer <kbd>${kb.steer}</kbd></div><div>Brake / reverse <kbd>${kb.brake}</kbd></div><div>Drift <kbd>${kb.drift}</kbd></div><div>Use item <kbd>${kb.item}</kbd></div><div>Respawn <kbd>R</kbd> · Look back <kbd>C</kbd> · Pause <kbd>Esc</kbd></div><div class="dim tiny" style="margin-top:6px">Gamepad: ${pad.steer} · ${pad.accel} gas · ${pad.brake} brake · ${pad.drift} drift · ${pad.item} item. Touch: on-screen pads, with auto-accelerate.</div></div></div>
        <div class="panel"><h3>Drifting</h3><div class="small">Tap drift while turning to hop into a slide. Hold it and the meter charges through <b style="color:#7dd3ff">blue</b>, <b style="color:#ffb02e">orange</b> and <b style="color:#d27dff">purple</b>. Release to fire a turbo boost — the longer the slide, the bigger the boost.</div></div>
        <div class="panel"><h3>Rocket start</h3><div class="small">Hold accelerate as the last light goes out for a free burst off the line — but go too early and you’ll stall.</div></div>
        <div class="panel"><h3>Surfaces</h3><div class="small">Stay on the tarmac: grass and sand slow you down. <b style="color:#9fe8ff">Ice</b> removes grip, <b style="color:#8ab4ff">wet</b> patches loosen it, and kerbs are safe to clip. Boost pads give a free burst.</div></div>
      </div>
      <div class="sect" style="margin-top:20px">Items</div>
      <div class="items">${Object.keys(ITEM_ICONS).map((i) => `<div class="panel it">${ITEM_ICONS[i]}<div><b>${ITEM_INFO[i]?.name || i}</b><div class="tiny dim">${itemDesc[i] || ''}</div></div></div>`).join('')}</div></div>`);
    this.bind(el, {});
  },
};
