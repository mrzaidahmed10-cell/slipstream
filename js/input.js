// Unified input: keyboard, gamepad, on-screen touch controls. Produces { steer, throttle, brake, drift, item, reset, look }.
import { clamp, damp } from './core/util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, brake: false, drift: false, item: false, gas: true };
    this.state = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, reset: false, look: false };
    this.device = 'keyboard';
    this.listeners = {};
    this.kbSteer = 0;
    this.padPrev = {};
    this.enabled = true;
    this.touchAutoGas = true;
    const norm = (e) => e.code;
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(norm(e)); this.device = 'keyboard';
      this.emit('key', e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause');
      if (e.code === 'KeyR') { this.resetFlag = true; this.emit('reset'); }
    });
    addEventListener('keyup', (e) => this.keys.delete(norm(e)));
    addEventListener('blur', () => this.keys.clear());
    this.bindTouch();
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return () => (this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn)); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  bindTouch() {
    const map = { 'tc-left': 'left', 'tc-right': 'right', 'tc-brake': 'brake', 'tc-drift': 'drift', 'tc-item': 'item' };
    const set = (id, v) => { const k = map[id]; if (k) { this.touch[k] = v; this.device = 'touch'; if (v && k === 'item') this.emit('touch-item'); } };
    const root = document;
    const handler = (type) => (e) => {
      const t = e.target.closest && e.target.closest('[data-tc]');
      if (type === 'start' && t) { e.preventDefault(); set(t.id, true); t.classList.add('down'); }
    };
    root.addEventListener('touchstart', handler('start'), { passive: false });
    const endAll = (e) => {
      // recompute active set from remaining touches
      const active = new Set();
      for (const tch of e.touches) { const el = document.elementFromPoint(tch.clientX, tch.clientY); const t = el && el.closest && el.closest('[data-tc]'); if (t) active.add(t.id); }
      for (const id of Object.keys(map)) { const on = active.has(id); if (!on) { set(id, false); const el = document.getElementById(id); if (el) el.classList.remove('down'); } }
    };
    root.addEventListener('touchend', endAll); root.addEventListener('touchcancel', endAll);
    root.addEventListener('touchmove', (e) => {
      const t0 = e.target.closest && e.target.closest('[data-tc-zone]');
      if (!t0) return;
      e.preventDefault();
      const active = new Set();
      for (const tch of e.touches) { const el = document.elementFromPoint(tch.clientX, tch.clientY); const t = el && el.closest && el.closest('[data-tc]'); if (t) active.add(t.id); }
      for (const id of ['tc-left', 'tc-right']) { set(id, active.has(id)); const el = document.getElementById(id); if (el) el.classList.toggle('down', active.has(id)); }
    }, { passive: false });
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  poll(dt) {
    const k = this.keys, s = this.state;
    let steerT = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    let thr = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0;
    let brk = k.has('ArrowDown') || k.has('KeyS') ? 1 : 0;
    let drift = k.has('Space') || k.has('ShiftLeft') && false;
    let item = k.has('KeyE') || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyF') || k.has('Enter') && false;
    let look = k.has('KeyC') || k.has('KeyB');
    // keyboard steering ramps for finer control
    const rate = steerT === 0 ? 14 : 7.5;
    this.kbSteer += (steerT - this.kbSteer) * damp(rate, dt);
    let steer = Math.abs(this.kbSteer) < 0.01 ? 0 : this.kbSteer;
    if (k.has('ArrowUp') || k.has('ArrowDown') || k.has('ArrowLeft') || k.has('ArrowRight') || k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD')) this.device = 'keyboard';

    // gamepad
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] || 0, dz = 0.12;
      const gs = Math.abs(ax) < dz ? 0 : Math.sign(ax) * (Math.abs(ax) - dz) / (1 - dz);
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      const a = p.buttons[0]?.pressed, b = p.buttons[1]?.pressed, x = p.buttons[2]?.pressed, y = p.buttons[3]?.pressed;
      const lb = p.buttons[4]?.pressed, rb = p.buttons[5]?.pressed;
      const dl = p.buttons[14]?.pressed, dr = p.buttons[15]?.pressed;
      const any = Math.abs(gs) > 0.2 || rt > 0.2 || lt > 0.2 || a || b || x || y || lb || rb;
      if (any) this.device = 'gamepad';
      if (this.device === 'gamepad') {
        steer = clamp(gs + (dr ? 1 : 0) - (dl ? 1 : 0), -1, 1);
        thr = Math.max(rt, a ? 1 : 0); brk = Math.max(lt, b ? 1 : 0);
        drift = !!(rb || x || lb && false); item = !!(y || lb); look = !!p.buttons[10]?.pressed;
        const start = !!p.buttons[9]?.pressed;
        if (start && !this.padPrev.start) this.emit('pause');
        this.padPrev.start = start;
      }
    }

    // touch
    if (this.device === 'touch') {
      const t = this.touch;
      steer = (t.right ? 1 : 0) - (t.left ? 1 : 0);
      thr = this.touchAutoGas && !t.brake ? 1 : 0; brk = t.brake ? 1 : 0; drift = t.drift; item = t.item;
      if (steer) this.kbSteer += (steer - this.kbSteer) * damp(9, dt); else this.kbSteer += (0 - this.kbSteer) * damp(14, dt);
      steer = this.kbSteer;
    }

    s.steer = clamp(steer, -1, 1); s.throttle = thr; s.brake = brk; s.drift = !!drift; s.item = !!item; s.look = !!look;
    s.reset = !!this.resetFlag; this.resetFlag = false;
    return s;
  }

  anyPress() { return this.keys.size > 0; }
}

export function keyHints(device) {
  if (device === 'touch') return { accel: 'Auto', steer: 'Left / Right pads', brake: 'BRAKE', drift: 'DRIFT', item: 'ITEM', reset: 'Menu → Respawn' };
  if (device === 'gamepad') return { accel: 'RT / A', steer: 'Left stick', brake: 'LT / B', drift: 'RB / X', item: 'Y / LB', reset: 'Menu → Respawn' };
  return { accel: 'W / ↑', steer: 'A D / ← →', brake: 'S / ↓', drift: 'Space', item: 'E / Shift', reset: 'R' };
}
