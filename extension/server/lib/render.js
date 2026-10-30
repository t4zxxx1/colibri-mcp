// Rendering compatto delle viste: una riga per elemento, diff tra viste.

/** Stima token: ~3,6 caratteri per token su testo italiano misto a id. */
export const estTokens = (s) => Math.ceil((s || '').length / 3.6);

const q = (s) => `"${s}"`;

/** mode: 'full' (vista), 'chg' (riga variata: senza ruolo e opzioni), 'neutral' (senza valore, per confronti) */
export function lineOf(it, withCtx, mode = 'full') {
  let l = mode === 'chg' ? it.id : `${it.id} ${it.role}`;
  if (it.name) l += ' ' + q(it.name);
  if (mode !== 'neutral') {
    if (it.checked !== undefined) l += it.checked ? ' [x]' : ' [ ]';
    if (it.value) l += ' =' + q(it.value);
  }
  if (mode === 'full') {
    if (Array.isArray(it.options) && it.options.length > 1) l += ' opz:' + it.options.join('|');
    else if (typeof it.options === 'number') l += ` opz:${it.options}`;
  }
  if (it.flags && it.flags.length) l += ' ' + it.flags.join(' ');
  if (it.s) l += ' !' + it.s;
  if (it.msg && mode !== 'neutral') l += ' »' + q(it.msg);
  if (withCtx && it.ctx && it.ctx !== it.name) l += ' @' + q(it.ctx);
  return l;
}

/**
 * Sequenze di elementi uguali con ref e numeri consecutivi (giorni di un calendario, pagine, taglie): una riga sola.
 * Il ref del k-esimo si ricava dal primo (e100 + k), quindi non si perde nessun riferimento.
 */
const idNum = (id) => {
  const m = /^(f\d+)?e(\d+)$/.exec(id || '');
  return m ? [m[1] || '', +m[2]] : null;
};
const numOf = (s) => {
  const m = /\d+/.exec(s || '');
  return m ? +m[0] : null;
};
const sameKind = (a, b) => a.role === b.role && a.reg === b.reg && (a.flags || []).join() === (b.flags || []).join() && (a.s || '') === (b.s || '') && !a.value === !b.value && a.checked === b.checked;
export function runAt(items, k, min = 6) {
  const a = items[k];
  const n0 = idNum(a.id);
  if (!n0 || numOf(a.name) === null) return 0;
  let j = k;
  while (j + 1 < items.length) {
    const p = items[j];
    const b = items[j + 1];
    const nb = idNum(b.id);
    const vb = numOf(b.name);
    // il numero cresce di 1; quando ricomincia (nuovo mese) inizia una riga nuova, cosi' ogni riga e' un mese
    if (!nb || nb[0] !== n0[0] || nb[1] !== n0[1] + (j + 1 - k) || vb === null || !sameKind(a, b) || vb !== numOf(p.name) + 1) break;
    j++;
  }
  return j - k + 1 >= min ? j - k + 1 : 0;
}
export function runLine(g) {
  const a = g[0];
  const z = g[g.length - 1];
  let l = `${a.id}..${z.id} ${a.role} ${q(a.name)}..${q(z.name)} (${g.length}, ref e numeri consecutivi)`;
  if (a.flags && a.flags.length) l += ' ' + a.flags.join(' ');
  if (a.s) l += ' !' + a.s;
  return l;
}

export function shortUrl(u) {
  if (!u || u.length <= 100) return u;
  try {
    const x = new URL(u);
    const p = x.pathname.length > 70 ? x.pathname.slice(0, 69) + '…' : x.pathname;
    return x.origin + p + (x.search || x.hash ? '?…' : '');
  } catch {
    return u.slice(0, 99) + '…';
  }
}

function headerLines(snap, url, tabs) {
  const m = snap.meta || {};
  const out = [];
  url = shortUrl(url);
  out.push(m.title ? `${url} | ${m.title}` : url);
  const info = [];
  if (m.h1 && m.h1 !== m.title) info.push('h1: ' + m.h1);
  if (m.h > m.vh) info.push(`scroll ${m.y}/${m.h - m.vh}`);
  if (tabs > 1) info.push(`schede ${tabs}`);
  if (info.length) out.push(info.join(' · '));
  if (snap.captcha) out.push(captchaLine(snap));
  if (snap.login) out.push("campo password: l'accesso lo fa l'utente nella finestra del browser");
  if (snap.modal) out.push(`[MODALE ${q(snap.modal)}] solo i suoi elementi`);
  for (const a of snap.alerts) out.push('! ' + a);
  return out;
}

function captchaLine(snap) {
  const c = snap.challenge;
  if (!c) return "CAPTCHA: lo risolve l'utente nella finestra del browser";
  if (c.block) return `VERIFICA ${c.kind}: pagina bloccata, chiedi all'utente di completarla nella finestra, poi browse_view`;
  return c.solved ? `CAPTCHA ${c.kind}: risolto` : `CAPTCHA ${c.kind}: all'invio Colibri aspetta che l'utente lo risolva`;
}

/** Vista completa (o filtrata/paginata) della pagina. */
export function renderView(snap, { url, tabs = 1, scope = 'main', filter = '', offset = 0, max = 120, maxChars = 5000, rows = true } = {}) {
  const out = headerLines(snap, url, tabs);
  let items = snap.items;
  if (rows === false) {
    // solo intestazione e conteggi: chi conosce gia' i nomi dei campi agisce subito con browse_do/browse_task
    const n = { campi: 0, pulsanti: 0, link: 0 };
    for (const i of items) {
      if (i.role === 'link') n.link++;
      else if (i.role === 'btn') n.pulsanti++;
      else n.campi++;
    }
    out.push(`${items.length} elementi (${Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nessuno'}): righe con browse_view`);
    return out.join('\n');
  }
  const f = (filter || '').toLowerCase().trim();
  if (f) items = items.filter((i) => `${i.name} ${i.role} ${i.value || ''} ${i.ctx || ''}`.toLowerCase().includes(f));

  // menu, header, footer e aside compressi quando la pagina e' grande
  const hidden = new Map();
  if (!f && scope !== 'all' && items.length > 60) {
    items = items.filter((i) => {
      const r = snap.regions[i.reg];
      if (r && r.low) {
        hidden.set(r.kind, (hidden.get(r.kind) || 0) + 1);
        return false;
      }
      return true;
    });
  }

  const cnt = new Map();
  for (const i of items) cnt.set(i.role + i.name, (cnt.get(i.role + i.name) || 0) + 1);

  let cur = -1;
  let shape = '';
  let same = 0;
  let skipped = 0;
  let shown = 0;
  let budget = maxChars;
  // ultima riga di gruppo emessa (righe senza id): le righe successive con gli stessi elementi mostrano solo i ref
  let prevRow = null;
  const flush = () => {
    if (skipped) out.push(`… altre ${skipped} righe uguali (filter:"testo della riga" o browse_read table)`);
    skipped = 0;
  };
  const noId = (x) => lineOf(x, false).slice(x.id.length);
  let k = offset;
  while (k < items.length) {
    const i = items[k];
    const rl = f ? 0 : runAt(items, k);
    if (rl) {
      flush();
      shape = '';
      prevRow = null;
      const line = runLine(items.slice(k, k + rl));
      if (shown >= max || budget - line.length < 0) {
        out.push(`… altri ${items.length - k} elementi (offset:${k} o filter)`);
        return finish(out, hidden);
      }
      if (i.reg !== cur) {
        const r = snap.regions[i.reg];
        if (r && !(snap.modal && r.kind === 'dlg')) out.push(`[${r.kind}${r.name ? ' ' + q(r.name) : ''}]`);
        else if (!r && cur >= 0) out.push('[pagina]');
        cur = i.reg;
      }
      out.push(line);
      budget -= line.length + 1;
      shown += 1;
      k += rl;
      continue;
    }
    let j = k;
    if (i.grp >= 0) while (j + 1 < items.length && items[j + 1].grp === i.grp && items[j + 1].reg === i.reg) j++;
    const g = items.slice(k, j + 1);
    // righe di tabella/lista con la stessa struttura: dopo 10 si riassumono
    const sh = i.grp >= 0 && !f ? i.reg + '|' + g.map((x) => x.role + x.name).join(',') : '';
    if (sh && sh === shape) same++;
    else {
      flush();
      shape = sh;
      same = 1;
    }
    if (sh && same > 10) {
      skipped++;
      k = j + 1;
      continue;
    }
    const dup = g.some((x) => cnt.get(x.role + x.name) > 1);
    const lab = i.ctx || '';
    const show = dup && lab && !g.some((x) => x.name && lab.toLowerCase().startsWith(x.name.toLowerCase()));
    const rowSig = g.map(noId);
    const compact = show && g.length > 1 && prevRow && prevRow.reg === i.reg && prevRow.sig.length === rowSig.length && rowSig.every((s, n) => s === prevRow.sig[n]);
    const line = (show ? `@${q(lab)}: ` : '') + (compact ? g.map((x) => x.id).join(' ') : g.map((x) => lineOf(x, false)).join(' · '));
    prevRow = show && g.length > 1 ? { reg: i.reg, sig: rowSig } : null;
    if (shown >= max || budget - line.length < 0) {
      out.push(`… altri ${items.length - k} elementi (offset:${k} o filter)`);
      return finish(out, hidden);
    }
    if (i.reg !== cur) {
      const r = snap.regions[i.reg];
      if (r && !(snap.modal && r.kind === 'dlg')) out.push(`[${r.kind}${r.name ? ' ' + q(r.name) : ''}]`);
      else if (!r && cur >= 0) out.push('[pagina]');
      cur = i.reg;
    }
    out.push(line);
    budget -= line.length + 1;
    shown += g.length;
    k = j + 1;
  }
  flush();
  if (!items.length) out.push(f ? `nessun elemento con "${filter}"` : '(nessun elemento interattivo visibile: usa browse_read)');
  return finish(out, hidden);
}

function finish(out, hidden) {
  if (hidden.size) {
    const n = [...hidden.values()].reduce((a, b) => a + b, 0);
    out.push(`[nascosti ${n} in ${[...hidden.keys()].join(',')}: scope:"all" o filter]`);
  }
  return out.join('\n');
}

export function snapKeys(snap) {
  const keys = new Map();
  const neut = new Map();
  let main = 0;
  for (const i of snap.items) {
    keys.set(i.id, lineOf(i, false));
    neut.set(i.id, lineOf(i, false, 'neutral'));
    const r = snap.regions[i.reg];
    if (!(r && r.low)) main++;
  }
  return { keys, neut, main };
}

/** Testo gia' restituito da una lettura (read/find): i ref che contiene e un test "questo testo e' gia' stato mostrato". */
export function readCover(text) {
  if (!text) return null;
  const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const all = new Set(words(text.replace(/\[(?:f\d+)?e\d+ ?|→(?:f\d+)?e\d+/g, ' ')));
  const skip = new Set(text.match(/\b(?:f\d+)?e\d+\b/g) || []);
  return {
    skip,
    has: (t) => {
      const w = words(t);
      return w.length > 0 && w.every((x) => all.has(x));
    },
  };
}

/**
 * Diff rispetto all'ultima vista. Restituisce null se la pagina e' cambiata troppo
 * (in quel caso conviene la vista completa). touched: id -> azione dei passi appena eseguiti;
 * i valori impostati come richiesto non vengono ripetuti (sono gia' noti a chi li ha scritti).
 */
export function renderDiff(prev, snap, { url, tabs = 1, touched = new Map(), fresh = [], skip = null } = {}) {
  const cur = snapKeys(snap);
  const added = [];
  const changed = [];
  const removed = [];
  let expected = 0;
  let skipped = 0;
  const byId = new Map(snap.items.map((i) => [i.id, i]));
  const cnt = new Map();
  for (const i of snap.items) cnt.set(i.role + i.name, (cnt.get(i.role + i.name) || 0) + 1);
  const addedIt = [];
  for (const [id, l] of cur.keys) {
    const it = byId.get(id);
    if (!prev.keys.has(id)) {
      // elementi gia' mostrati con il loro ref dalla lettura (schede): non si ripetono
      if (skip && skip.has(id)) skipped++;
      else addedIt.push(it);
    } else if (prev.keys.get(id) !== l) {
      const t = touched.get(id);
      if (t && t !== 'select' && prev.neut.get(id) === cur.neut.get(id)) expected++;
      else changed.push(lineOf(it, false, 'chg'));
    }
  }
  for (const id of prev.keys.keys()) if (!cur.keys.has(id)) removed.push(id);
  // giorni di un calendario, pagine, taglie: una riga per sequenza
  const nAdded = addedIt.length;
  for (let k = 0; k < addedIt.length; ) {
    const rl = runAt(addedIt, k);
    if (rl) {
      added.push(runLine(addedIt.slice(k, k + rl)));
      k += rl;
    } else {
      added.push(lineOf(addedIt[k], cnt.get(addedIt[k].role + addedIt[k].name) > 1));
      k++;
    }
  }
  const churn = nAdded + removed.length + skipped;
  if (churn > Math.max(10, 0.5 * Math.max(prev.main, cur.main))) return null;

  const out = [];
  const n = nAdded + changed.length + removed.length + skipped;
  // il diff si produce solo se la pagina non e' cambiata: l'URL e' gia' noto a chi legge e non si ripete
  const parts = [];
  if (expected) parts.push(`${expected} campi impostati come richiesto`);
  parts.push(n ? `${n} altre variazioni` : 'nessun altro effetto visibile');
  if (tabs > 1) parts.push('schede ' + tabs);
  out.push(parts.join(' · '));
  if (snap.captcha) out.push(captchaLine(snap));
  if (snap.modal) out.push(`[MODALE ${q(snap.modal)}]`);
  for (const a of snap.alerts) out.push('! ' + a);
  for (const t of fresh) out.push('» ' + t);
  for (const l of changed) out.push('~ ' + l);
  for (const l of added.slice(0, 60)) out.push('+ ' + l);
  if (added.length > 60) out.push(`+ … altri ${added.length - 60} (browse_view)`);
  if (skipped) out.push(`+ ${skipped} nuovi gia' elencati con il ref nella lettura`);
  if (removed.length) out.push(`- ${removed.length} rimossi: ` + removed.slice(0, 12).join(' ') + (removed.length > 12 ? ' …' : ''));
  return out.join('\n');
}
