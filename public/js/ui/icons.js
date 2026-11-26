// Inline SVG icons for items, classes and UI.
const s = (body, vb = '0 0 48 48') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
export const ITEM_ICONS = {
  turbo: s('<path d="M27 4 10 27h11l-3 17 20-26H27z" fill="#ffb02e" stroke="#fff3c4" stroke-width="2" stroke-linejoin="round"/>'),
  triple: s('<g fill="#ff7a1a" stroke="#ffe1c4" stroke-width="1.6" stroke-linejoin="round"><path d="M13 6 3 24h7l-2 14 12-18h-7z"/><path d="M26 6 16 24h7l-2 14 12-18h-7z" transform="translate(2 4)"/><path d="M37 8 29 22h6l-2 12 10-15h-6z" transform="translate(0 4)"/></g>'),
  oil: s('<path d="M24 5C16 16 10 22 10 30a14 14 0 0 0 28 0c0-8-6-14-14-25z" fill="#8a5cff" stroke="#e3d6ff" stroke-width="2"/><path d="M18 31a6 6 0 0 0 6 6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>'),
  mine: s('<g fill="#ff4f4f" stroke="#ffd1d1" stroke-width="1.6"><circle cx="24" cy="24" r="11"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8M10 10l6 6M32 32l6 6M38 10l-6 6M16 32l-6 6" stroke-width="3.5" stroke-linecap="round"/></g><circle cx="24" cy="24" r="4" fill="#fff"/>'),
  seeker: s('<g fill="none" stroke="#2ee6c8" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="14"/><circle cx="24" cy="24" r="5" fill="#2ee6c8"/><path d="M24 2v9M24 37v9M2 24h9M37 24h9"/></g>'),
  shield: s('<path d="M24 4 8 10v12c0 11 7 18 16 22 9-4 16-11 16-22V10z" fill="#4da3ff" stroke="#d6e9ff" stroke-width="2.2" stroke-linejoin="round"/><path d="M24 12v26M14 20h20" stroke="#fff" stroke-width="2.5" opacity=".55"/>'),
};
export const ICON = {
  flag: s('<path d="M10 42V6M10 8h26l-5 9 5 9H10" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  trophy: s('<path d="M14 6h20v12a10 10 0 0 1-20 0zM14 10H6c0 8 3 12 9 13M34 10h8c0 8-3 12-9 13M24 28v8M16 42h16M18 36h12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  clock: s('<circle cx="24" cy="25" r="16" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M24 14v11l7 5M19 5h10" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'),
  wrench: s('<path d="M30 6a10 10 0 0 0-9 13L6 34a4 4 0 0 0 6 6l15-15a10 10 0 0 0 13-9l-7 5-6-2-2-6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'),
  board: s('<path d="M6 40V26h9v14M19 40V10h10v30M33 40V20h9v20M4 40h40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  gear: s('<circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7M10 10l5 5M33 33l5 5M38 10l-5 5M15 33l-5 5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>'),
  help: s('<circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M18 19a6 6 0 1 1 9 5c-2 1.5-3 2.500-3 5M24 35v.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>'),
  user: s('<circle cx="24" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M8 42c2-10 8-14 16-14s14 4 16 14" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'),
  back: s('<path d="M30 8 14 24l16 16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'),
  play: s('<path d="M14 8v32l26-16z" fill="currentColor"/>'),
  check: s('<path d="M8 25l10 10L40 12" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'),
  pause: s('<path d="M15 8v32M33 8v32" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'),
  retry: s('<path d="M40 24a16 16 0 1 1-5-11.500M40 6v10H30" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  cloud: s('<path d="M14 36a9 9 0 0 1-1-18 12 12 0 0 1 23 3 8 8 0 0 1-1 15z" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round"/>'),
  car: s('<path d="M6 30l4-10c1-3 3-4 6-4h16c3 0 5 1 6 4l4 10v6H6zM12 36v4M36 36v4" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="14" cy="30" r="2.500" fill="currentColor"/><circle cx="34" cy="30" r="2.500" fill="currentColor"/>'),
};
export const logoMark = s('<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34e0ff"/><stop offset="1" stop-color="#ff4fa8"/></linearGradient></defs><path d="M4 30c8-2 14-8 20-16 2-3 6-4 10-4l10 2c-6 1-10 4-14 9-6 8-14 13-26 14z" fill="url(#lg)"/><path d="M4 40c10-1 18-6 26-14 3-3 6-5 10-6-3 5-6 8-10 12-6 6-14 8-26 8z" fill="url(#lg)" opacity=".55"/>');
