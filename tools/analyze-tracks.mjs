// Prints geometry stats for every track and writes an SVG preview per track.
import { TRACK_DEFS, getTrack } from '../js/core/tracks.js';
import fs from 'node:fs';
const out = process.argv[2] || '.';
for (const d of TRACK_DEFS) {
  const t = getTrack(d.id);
  const a = t.analyze();
  console.log(d.id.padEnd(9), 'len', a.length.toFixed(0).padStart(5), 'minR', a.minRadius.toFixed(0).padStart(4), 'minSep', a.minSep.toFixed(0).padStart(4), 'width', t.baseWidth);
  let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9;
  for(let i=0;i<t.N;i++){minx=Math.min(minx,t.X[i]);maxx=Math.max(maxx,t.X[i]);minz=Math.min(minz,t.Z[i]);maxz=Math.max(maxz,t.Z[i]);}
  const pad=40, S=1; const W=(maxx-minx)+pad*2, H=(maxz-minz)+pad*2;
  let path='';
  for(let i=0;i<t.N;i++){ const x=-(t.X[i]-maxx)+pad, y=(maxz-t.Z[i])+pad; path+=(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1); }
  path+='Z';
  const sx=-(t.X[0]-maxx)+pad, sy=(maxz-t.Z[0])+pad;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#14181f"/><path d="${path}" fill="none" stroke="#3a4352" stroke-width="${t.baseWidth}" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="6 6"/><circle cx="${sx}" cy="${sy}" r="9" fill="#ffd23f"/><text x="12" y="22" fill="#fff" font-size="18" font-family="sans-serif">${d.id} ${a.length.toFixed(0)}m minR ${a.minRadius.toFixed(0)} sep ${a.minSep.toFixed(0)}</text></svg>`;
  fs.writeFileSync(out + '/' + d.id + '.svg', svg);
}
