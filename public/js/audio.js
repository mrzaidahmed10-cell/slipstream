// Procedural audio: engine, drift, boost, item and UI sounds, plus a lightweight generative music loop.
export class Audio {
  constructor() {
    this.ctx = null; this.master = null; this.sfxBus = null; this.musicBus = null; this.engine = null;
    this.vol = { master: 0.8, sfx: 0.9, music: 0.45 };
    this.muted = false; this.music = null; this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.sfxBus = this.ctx.createGain(); this.musicBus = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
      this.sfxBus.connect(this.master); this.musicBus.connect(this.master); this.master.connect(comp); comp.connect(this.ctx.destination);
      this.applyVolumes();
      const len = this.ctx.sampleRate * 1.5; this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  }
  applyVolumes() {
    if (!this.ctx) return;
    const m = this.muted ? 0 : this.vol.master;
    this.master.gain.value = m; this.sfxBus.gain.value = this.vol.sfx; this.musicBus.gain.value = this.vol.music;
  }
  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  t() { return this.ctx.currentTime; }

  // ---- engine loop (player)
  startEngine() {
    if (!this.ensure() || this.engine) return;
    const c = this.ctx;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'triangle';
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3;
    const g = c.createGain(); g.gain.value = 0;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2200; nf.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0;
    const o1g = c.createGain(), o2g = c.createGain(), o3g = c.createGain(); o1g.gain.value = 0.5; o2g.gain.value = 0.16; o3g.gain.value = 0.36;
    o1.connect(o1g).connect(f); o2.connect(o2g).connect(f); o3.connect(o3g).connect(f); f.connect(g).connect(this.sfxBus);
    n.connect(nf).connect(ng).connect(this.sfxBus);
    // drift squeal
    const sq = c.createOscillator(); sq.type = 'sawtooth'; const sqf = c.createBiquadFilter(); sqf.type = 'bandpass'; sqf.frequency.value = 1900; sqf.Q.value = 9; const sqg = c.createGain(); sqg.gain.value = 0;
    sq.connect(sqf).connect(sqg).connect(this.sfxBus);
    [o1, o2, o3, n, sq].forEach((x) => x.start());
    this.engine = { o1, o2, o3, f, g, nf, ng, sq, sqg, sqf };
  }
  updateEngine(speedRatio, throttle, boosting, drifting, offroad) {
    const e = this.engine; if (!e) return;
    const t = this.t();
    const base = 55 + speedRatio * 150 + (boosting ? 40 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.04); e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.04); e.o3.frequency.setTargetAtTime(base * 1.5, t, 0.04);
    e.f.frequency.setTargetAtTime(500 + speedRatio * 1600 + throttle * 700, t, 0.06);
    e.g.gain.setTargetAtTime(0.1 + throttle * 0.08 + speedRatio * 0.06, t, 0.05);
    e.ng.gain.setTargetAtTime((boosting ? 0.1 : 0.0) + speedRatio * 0.03 + (offroad ? 0.06 : 0), t, 0.06);
    e.nf.frequency.setTargetAtTime(1500 + speedRatio * 3000, t, 0.08);
    e.sqg.gain.setTargetAtTime(drifting ? 0.025 + speedRatio * 0.02 : 0, t, 0.05);
    e.sq.frequency.setTargetAtTime(1500 + speedRatio * 700 + (Math.random() - 0.5) * 80, t, 0.03);
  }
  stopEngine() {
    const e = this.engine; if (!e) return;
    const t = this.t(); e.g.gain.setTargetAtTime(0, t, 0.05); e.ng.gain.setTargetAtTime(0, t, 0.05); e.sqg.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { try { [e.o1, e.o2, e.o3, e.sq].forEach((x) => x.stop()); } catch (_) {} }, 300);
    this.engine = null;
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, slide = 0, when = 0, bus = null, attack = 0.005 } = {}) {
    if (!this.ensure()) return;
    const c = this.ctx, t = this.t() + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { gain = 0.3, f0 = 1200, f1 = 300, q = 1, type = 'bandpass', when = 0 } = {}) {
    if (!this.ensure()) return;
    const c = this.ctx, t = this.t() + when;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.sfxBus); n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }

  sfx(name, p = {}) {
    if (!this.ensure()) return;
    switch (name) {
      case 'count': this.tone(520, 0.22, { type: 'square', gain: 0.18 }); break;
      case 'go': this.tone(1040, 0.5, { type: 'square', gain: 0.2 }); this.tone(1560, 0.5, { type: 'triangle', gain: 0.18 }); break;
      case 'boost': this.noise(0.7, { gain: 0.35, f0: 600, f1: 3500, q: 0.7 }); this.tone(220, 0.5, { type: 'sawtooth', gain: 0.12, slide: 500 }); break;
      case 'tier': this.tone(660 + (p.tier || 1) * 220, 0.14, { type: 'triangle', gain: 0.18 }); break;
      case 'hop': this.tone(300, 0.1, { type: 'sine', gain: 0.18, slide: 200 }); break;
      case 'box': this.tone(880, 0.09, { type: 'square', gain: 0.1 }); this.tone(1320, 0.09, { type: 'square', gain: 0.1, when: 0.07 }); this.tone(1760, 0.14, { type: 'square', gain: 0.1, when: 0.14 }); break;
      case 'item-got': this.tone(1200, 0.12, { type: 'triangle', gain: 0.18 }); this.tone(1600, 0.2, { type: 'triangle', gain: 0.18, when: 0.1 }); break;
      case 'item-use': this.tone(500, 0.14, { type: 'square', gain: 0.12, slide: 300 }); break;
      case 'hit': this.noise(0.5, { gain: 0.5, f0: 1500, f1: 120, q: 0.5 }); this.tone(180, 0.5, { type: 'sawtooth', gain: 0.25, slide: -140 }); break;
      case 'wall': this.noise(0.18, { gain: 0.25 * Math.min(1.5, (p.power || 6) / 8), f0: 800, f1: 150 }); this.tone(110, 0.14, { type: 'square', gain: 0.12, slide: -50 }); break;
      case 'bump': this.noise(0.12, { gain: 0.18, f0: 700, f1: 200 }); break;
      case 'explosion': this.noise(0.9, { gain: 0.7, f0: 900, f1: 60, q: 0.4, type: 'lowpass' }); this.tone(90, 0.7, { type: 'sine', gain: 0.4, slide: -60 }); break;
      case 'shield': this.tone(700, 0.3, { type: 'sine', gain: 0.18, slide: 600 }); break;
      case 'pop': this.noise(0.3, { gain: 0.3, f0: 4000, f1: 800 }); break;
      case 'lap': this.tone(784, 0.14, { type: 'triangle', gain: 0.2 }); this.tone(988, 0.14, { type: 'triangle', gain: 0.2, when: 0.12 }); this.tone(1175, 0.25, { type: 'triangle', gain: 0.2, when: 0.24 }); break;
      case 'finish': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', gain: 0.22, when: i * 0.13 })); break;
      case 'ui': this.tone(740, 0.05, { type: 'sine', gain: 0.1 }); break;
      case 'ui-ok': this.tone(660, 0.07, { type: 'triangle', gain: 0.14 }); this.tone(990, 0.1, { type: 'triangle', gain: 0.14, when: 0.06 }); break;
      case 'ui-back': this.tone(520, 0.07, { type: 'triangle', gain: 0.12 }); this.tone(390, 0.1, { type: 'triangle', gain: 0.12, when: 0.06 }); break;
      case 'step': [659, 880, 1319].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', gain: 0.18, when: i * 0.08 })); break;
      case 'rocket': this.noise(0.8, { gain: 0.4, f0: 500, f1: 4000 }); break;
      case 'respawn': this.tone(400, 0.3, { type: 'sine', gain: 0.15, slide: 400 }); break;
    }
  }

  // ---- generative music
  startMusic(style = 'menu') {
    if (!this.ensure()) return;
    this.stopMusic();
    const styles = {
      menu: { bpm: 104, root: 57, scale: [0, 3, 7, 10], chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]], lead: 'triangle' },
      race: { bpm: 138, root: 52, scale: [0, 2, 3, 7, 9], chords: [[0, 7, 12], [3, 10, 15], [5, 12, 17], [7, 14, 19]], lead: 'square' },
      stadium: { bpm: 140, root: 52, scale: [0, 3, 5, 7, 10], chords: [[0, 7, 12], [5, 12, 17], [3, 10, 15], [7, 14, 19]], lead: 'sawtooth' },
      desert: { bpm: 126, root: 50, scale: [0, 1, 4, 5, 7, 8, 10], chords: [[0, 7, 12], [1, 8, 13], [0, 7, 12], [10, 17, 22]], lead: 'triangle' },
      winter: { bpm: 118, root: 55, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]], lead: 'sine' },
      beach: { bpm: 122, root: 53, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], lead: 'triangle' },
      forest: { bpm: 112, root: 52, scale: [0, 2, 3, 5, 7, 8, 10], chords: [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 10, 14]], lead: 'triangle' },
      city: { bpm: 132, root: 48, scale: [0, 3, 5, 6, 7, 10], chords: [[0, 7, 10], [3, 10, 14], [5, 12, 15], [7, 14, 17]], lead: 'sawtooth' },
    };
    const S = styles[style] || styles.menu;
    const c = this.ctx, beat = 60 / S.bpm, step = beat / 4;
    let next = c.currentTime + 0.1, i = 0, alive = true;
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const mt = (f, d, type, g, when) => this.tone(f, d, { type, gain: g, when: when - c.currentTime, bus: this.musicBus, attack: 0.01 });
    const sched = () => {
      if (!alive) return;
      while (next < c.currentTime + 0.4) {
        const bar = Math.floor(i / 16) % 4, pos = i % 16, ch = S.chords[bar];
        if (pos % 4 === 0 && (pos === 0 || style !== 'winter')) mt(hz(S.root - 12 + ch[0]), beat * 0.9, 'triangle', 0.16, next);
        if (pos % 2 === 0) mt(hz(S.root + 12 + ch[(pos / 2) % ch.length]), step * 1.6, S.lead, 0.045, next);
        if (pos === 0) ch.forEach((n) => mt(hz(S.root + n), beat * 3.6, 'sine', 0.03, next));
        if (style !== 'winter' && style !== 'forest' && pos % 8 === 4) this.noise(0.1, { gain: 0.06, f0: 6000, f1: 3000, type: 'highpass', when: next - c.currentTime });
        if (pos % 16 === 0 && style !== 'winter') this.noise(0.14, { gain: 0.1, f0: 200, f1: 60, type: 'lowpass', when: next - c.currentTime });
        if (Math.random() < 0.28) mt(hz(S.root + 24 + S.scale[Math.floor(Math.random() * S.scale.length)]), step * 2.2, S.lead, 0.032, next);
        next += step; i++;
      }
      this.musicTimer = setTimeout(sched, 120);
    };
    sched();
    this.music = { stop: () => { alive = false; clearTimeout(this.musicTimer); }, style };
  }
  stopMusic() { if (this.music) { this.music.stop(); this.music = null; } }
  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
