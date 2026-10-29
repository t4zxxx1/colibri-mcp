// Estrazione del testo dai PDF scaricati, senza dipendenze: FlateDecode, object stream, mappe ToUnicode,
// operatori di testo Tj/TJ/'/". Basta per i PDF generati (biglietti, ricevute, moduli); niente OCR.
import fs from 'node:fs';
import zlib from 'node:zlib';

const WIN = { 0x80: '€', 0x82: '‚', 0x84: '„', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™' };

function inflate(buf) {
  for (const f of [zlib.inflateSync, zlib.inflateRawSync]) {
    try {
      return f(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {}
  }
  return null;
}

function parseObjects(bin) {
  const s = bin.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    let body = s.slice(start, end);
    let stream = null;
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const d0 = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
      let d1 = s.lastIndexOf('endstream', end);
      if (d1 < d0) d1 = end;
      let raw = bin.subarray(d0, d1);
      if (raw[raw.length - 1] === 0x0a) raw = raw.subarray(0, raw.length - (raw[raw.length - 2] === 0x0d ? 2 : 1));
      body = body.slice(0, si);
      stream = raw;
    }
    objs.set(+m[1], { dict: body, raw: stream });
    re.lastIndex = end;
  }
  const data = (o) => {
    if (!o || !o.raw) return null;
    if (o.data !== undefined) return o.data;
    o.data = /\/FlateDecode/.test(o.dict) ? inflate(o.raw) : /\/Filter/.test(o.dict) ? null : o.raw;
    return o.data;
  };
  // oggetti compressi dentro gli object stream
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const d = data(o);
    if (!d) continue;
    const t = d.toString('latin1');
    const n = +(/\/N\s+(\d+)/.exec(o.dict) || [])[1];
    const first = +(/\/First\s+(\d+)/.exec(o.dict) || [])[1];
    const nums = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const num = nums[2 * k];
      const a = first + nums[2 * k + 1];
      const b = k + 1 < n ? first + nums[2 * k + 3] : t.length;
      if (!objs.has(num)) objs.set(num, { dict: t.slice(a, b), raw: null });
    }
  }
  return { objs, data };
}

const ref = (s, key) => {
  const m = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R').exec(s);
  return m ? +m[1] : null;
};
const refs = (s) => [...s.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => +m[1]);
// sotto-dizionario <<...>> dopo /key (con annidamenti)
function subDict(s, key) {
  const i = s.search(new RegExp('/' + key + '\\s*<<'));
  if (i < 0) return null;
  let k = s.indexOf('<<', i);
  let depth = 0;
  for (let j = k; j < s.length - 1; j++) {
    if (s[j] === '<' && s[j + 1] === '<') (depth++, j++);
    else if (s[j] === '>' && s[j + 1] === '>') {
      depth--;
      j++;
      if (!depth) return s.slice(k + 2, j - 1);
    }
  }
  return null;
}

function parseCMap(t) {
  const map = new Map();
  let bytes = 1;
  const hex = (h) => parseInt(h, 16);
  const uni = (h) => {
    let out = '';
    for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(hex(h.slice(i, i + 4)));
    return out || String.fromCharCode(hex(h));
  };
  const cs = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(t);
  if (cs) bytes = cs[1].length / 2;
  for (const b of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of b[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      map.set(hex(m[1]), uni(m[2]));
      bytes = Math.max(bytes, m[1].length / 2);
    }
  for (const b of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of b[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
      const lo = hex(m[1]);
      const hi = hex(m[2]);
      bytes = Math.max(bytes, m[1].length / 2);
      if (m[4] !== undefined) {
        const base = hex(m[4]);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCodePoint(base + c - lo));
      } else {
        const arr = [...m[5].matchAll(/<([0-9a-f]+)>/gi)].map((x) => uni(x[1]));
        arr.forEach((u, k) => map.set(lo + k, u));
      }
    }
  }
  return { map, bytes };
}

function decodeStr(bytes, cmap) {
  if (cmap) {
    let out = '';
    for (let i = 0; i + cmap.bytes <= bytes.length; i += cmap.bytes) {
      let c = 0;
      for (let k = 0; k < cmap.bytes; k++) c = (c << 8) | bytes[i + k];
      out += cmap.map.get(c) ?? '';
    }
    return out;
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  return bytes.map((b) => WIN[b] || String.fromCharCode(b)).join('');
}

// tokenizzatore del flusso di contenuto: restituisce il testo della pagina
function pageText(t, fonts) {
  const out = [];
  let line = '';
  let cmap = null;
  const stack = [];
  let lastY = null;
  const flush = () => {
    if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim());
    line = '';
  };
  const readString = (i) => {
    const bytes = [];
    let depth = 1;
    for (i++; i < t.length && depth; i++) {
      let c = t[i];
      if (c === '\\') {
        const n = t[++i];
        const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n];
        if (esc !== undefined) bytes.push(esc);
        else if (/[0-7]/.test(n)) {
          let o = n;
          while (o.length < 3 && /[0-7]/.test(t[i + 1])) o += t[++i];
          bytes.push(parseInt(o, 8) & 255);
        } else if (n === '\r' || n === '\n') {
          if (n === '\r' && t[i + 1] === '\n') i++;
        } else bytes.push(n.charCodeAt(0) & 255);
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')' && !--depth) break;
      bytes.push(c.charCodeAt(0) & 255);
    }
    return { v: { s: bytes }, i: i + 1 };
  };
  for (let i = 0; i < t.length; ) {
    const c = t[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < t.length && t[i] !== '\n' && t[i] !== '\r') i++; continue; }
    if (c === '(') { const r = readString(i); stack.push(r.v); i = r.i; continue; }
    if (c === '<' && t[i + 1] !== '<') {
      const j = t.indexOf('>', i);
      const h = t.slice(i + 1, j).replace(/\s+/g, '');
      const bytes = [];
      for (let k = 0; k < h.length; k += 2) bytes.push(parseInt((h.slice(k, k + 2) + '0').slice(0, 2), 16));
      stack.push({ s: bytes });
      i = j + 1;
      continue;
    }
    if (c === '[') { stack.push('['); i++; continue; }
    if (c === ']') {
      const arr = [];
      while (stack.length && stack[stack.length - 1] !== '[') arr.unshift(stack.pop());
      stack.pop();
      stack.push({ arr });
      i++;
      continue;
    }
    if (c === '<' || c === '>') { i += 2; continue; }
    if (c === '/') {
      let j = i + 1;
      while (j < t.length && !/[\s/[\]()<>{}%]/.test(t[j])) j++;
      stack.push({ name: t.slice(i + 1, j) });
      i = j;
      continue;
    }
    let j = i;
    while (j < t.length && !/[\s/[\]()<>{}%]/.test(t[j])) j++;
    if (j === i) { i++; continue; }
    const w = t.slice(i, j);
    i = j;
    if (/^[-+.\d]/.test(w)) { stack.push(+w); continue; }
    const arg = stack.splice(0);
    const show = (v) => (line += decodeStr(v.s, cmap));
    switch (w) {
      case 'Tf': {
        const n = arg.find((x) => x && x.name);
        cmap = n ? fonts.get(n.name) || null : null;
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        if (w !== 'Tj') flush();
        const v = arg.reverse().find((x) => x && x.s);
        if (v) show(v);
        break;
      }
      case 'TJ': {
        const a = arg.find((x) => x && x.arr);
        if (a) for (const x of a.arr) if (x && x.s) show(x); else if (typeof x === 'number' && x < -300) line += ' ';
        break;
      }
      case 'Td':
      case 'TD':
      case 'Tm': {
        const y = typeof arg[arg.length - 1] === 'number' ? arg[arg.length - 1] : 0;
        if (w === 'Tm') {
          // stessa riga (celle di una tabella, blocchi affiancati): separate da uno spazio
          if (lastY !== null && Math.abs(y - lastY) < 1) line += ' ';
          else flush();
          lastY = y;
        } else if (y !== 0) {
          flush();
          if (lastY !== null) lastY += y;
        }
        // Td con y = 0: spostamento nella stessa parola (crenatura), gli spazi veri sono glifi
        break;
      }
      case 'T*':
        flush();
        break;
      case 'BI':
        // immagine in linea: si salta fino a EI
        i = t.indexOf('EI', i);
        i = i < 0 ? t.length : i + 2;
        break;
    }
  }
  flush();
  return out;
}

export function pdfText(file) {
  const bin = fs.readFileSync(file);
  if (bin.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('non e\' un PDF');
  const { objs, data } = parseObjects(bin);
  const get = (n) => objs.get(n);
  const cmaps = new Map();
  const fontMap = (fontNum) => {
    if (cmaps.has(fontNum)) return cmaps.get(fontNum);
    let cm = null;
    const f = get(fontNum);
    const tu = f && ref(f.dict, 'ToUnicode');
    const d = tu && data(get(tu));
    if (d) cm = parseCMap(d.toString('latin1'));
    cmaps.set(fontNum, cm);
    return cm;
  };
  const inherited = (o, key) => {
    for (let k = 0, cur = o; cur && k < 20; k++) {
      if (new RegExp('/' + key + '\\b').test(cur.dict)) return cur;
      const p = ref(cur.dict, 'Parent');
      cur = p && get(p);
    }
    return null;
  };
  // pagine nell'ordine dell'albero /Pages
  const pages = [];
  const seen = new Set();
  const walk = (n) => {
    if (seen.has(n) || pages.length > 2000) return;
    seen.add(n);
    const o = get(n);
    if (!o) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) pages.push(o);
    else {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
      if (kids) for (const k of refs(kids[1])) walk(k);
    }
  };
  const cat = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  if (cat && ref(cat.dict, 'Pages')) walk(ref(cat.dict, 'Pages'));
  if (!pages.length) for (const o of objs.values()) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) pages.push(o);
  const texts = pages.map((pg) => {
    const fonts = new Map();
    const rh = inherited(pg, 'Resources');
    if (rh) {
      const rn = ref(rh.dict, 'Resources');
      const res = rn ? get(rn) && get(rn).dict : subDict(rh.dict, 'Resources');
      if (res) {
        const fn = ref(res, 'Font');
        const fd = fn ? get(fn) && get(fn).dict : subDict(res, 'Font');
        if (fd) for (const m of fd.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts.set(m[1], fontMap(+m[2]));
      }
    }
    const c = /\/Contents\s*(\[([^\]]*)\]|(\d+)\s+\d+\s+R)/.exec(pg.dict);
    const nums = c ? (c[2] !== undefined ? refs(c[2]) : [+c[3]]) : [];
    const content = nums.map((n) => data(get(n))).filter(Boolean).map((b) => b.toString('latin1')).join('\n');
    return pageText(content, fonts).join('\n');
  });
  return { pages: texts.length, text: texts.map((t, k) => (texts.length > 1 ? `[pagina ${k + 1}]\n` : '') + t).join('\n\n').trim() };
}
