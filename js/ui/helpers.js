export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const stars = (n, max = 4) => `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(Math.max(0, max - n))}</i></span>`;

// Coach: the floating tutorial card plus big centre toasts.
export class Coach {
  constructor(el, toastEl) { this.el = el; this.toastEl = toastEl; this.onSkip = null; this.tt = 0; this.ht = 0; }
  show({ n, total, title, body, skip }) {
    this.el.hidden = false;
    this.el.innerHTML = `<div class="ch"><span class="step">STEP ${n} / ${total}</span>${skip ? '<button class="skip" id="co-skip">Skip test drive</button>' : ''}</div><h3>${title}</h3><p>${body}</p><div class="hint" id="co-hint"></div><div class="pbar"><i id="co-bar"></i></div>`;
    const b = this.el.querySelector('#co-skip'); if (b) b.onclick = () => this.onSkip?.();
  }
  hide() { this.el.hidden = true; }
  progress(f) { const b = this.el.querySelector('#co-bar'); if (b) b.style.width = Math.max(0, Math.min(1, f)) * 100 + '%'; }
  hint(t) { const h = this.el.querySelector('#co-hint'); if (!h) return; h.textContent = t; clearTimeout(this.ht); this.ht = setTimeout(() => (h.textContent = ''), 4500); }
  toast(t, ms = 1300) { const e = this.toastEl; e.textContent = t; e.classList.add('show'); clearTimeout(this.tt); this.tt = setTimeout(() => e.classList.remove('show'), ms); }
}

// Quick confetti burst for wins and podiums.
export function confetti(host = document.body, ms = 3200) {
  const cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
  cv.width = innerWidth; cv.height = innerHeight; host.appendChild(cv); const g = cv.getContext('2d');
  const cols = ['#34e0ff', '#ff4fa8', '#ffd23f', '#7dff9a', '#b57aff', '#ffffff'];
  const ps = Array.from({ length: 140 }, () => ({ x: cv.width * (0.2 + Math.random() * 0.6), y: -20 - Math.random() * cv.height * 0.4, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  (function tick(now) {
    const t = now - t0; g.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.a += p.va; g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.globalAlpha = Math.max(0, 1 - t / ms); g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore(); }
    if (t < ms) requestAnimationFrame(tick); else cv.remove();
  })(t0);
}
