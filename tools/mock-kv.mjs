// Minimal in-memory KV with the same surface the API uses (get/put/delete, optional TTL, optional disk persistence).
import fs from 'node:fs';
export function makeKV(file = null) {
  let data = {};
  if (file && fs.existsSync(file)) { try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  const save = () => { if (file) fs.writeFileSync(file, JSON.stringify(data)); };
  return {
    async get(key, type = 'text') {
      const e = data[key]; if (!e) return null;
      if (e.exp && e.exp < Date.now()) { delete data[key]; return null; }
      const t = typeof type === 'object' ? type.type : type;
      return t === 'json' ? JSON.parse(e.v) : e.v;
    },
    async put(key, value, opts = {}) { data[key] = { v: String(value), exp: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 }; save(); },
    async delete(key) { delete data[key]; save(); },
    _data: data,
  };
}
