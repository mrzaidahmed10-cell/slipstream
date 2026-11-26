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
