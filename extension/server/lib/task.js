// browse_task: compito guidato in stile jev_task, con il motore decisionale locale al posto di Jev.
// Ciclo: osserva -> valuta -> decidi (abbinamento parametri) -> localizza -> controllo di sicurezza -> agisci -> verifica.
// Claude (il "Sistema 2") riceve solo l'esito e le domande sui casi incerti.
import fs from 'node:fs';
import path from 'node:path';
import * as P from './page-script.js';
import { renderView, renderDiff, shortUrl } from './render.js';
import { PRESETS, fold, fieldsFrom, groundParam, assign, decide, chooseOption, valueKind, formatDateFor, truthy, extractField, similarity, choice, optionScore, parseDateTime, monthOf } from './engine.js';

const pct = (p) => Math.round(p * 100) + '%';
const firstLine = (e) => String((e && e.message) || e).split('\n')[0].replace(/^\w+Error: /, '').slice(0, 200);
const isRef = (s) => /^(f\d+)?e\d+$/.test(String(s).trim());

function memoryFile(S) {
  return path.join(path.dirname(S.cfg.profileDir), 'site-memory.json');
}
function loadMemory(S) {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(S), 'utf8'));
  } catch {
    return {};
  }
}
function saveMemory(S, host, pairs) {
  if (!pairs.length) return;
  const m = loadMemory(S);
  m[host] = m[host] || {};
  for (const [k, v] of pairs) m[host][fold(k)] = v;
  try {
    fs.mkdirSync(path.dirname(memoryFile(S)), { recursive: true });
    fs.writeFileSync(memoryFile(S), JSON.stringify(m, null, 1));
  } catch {}
}

function normParams(params) {
  return Object.entries(params || {}).map(([key, v]) =>
    v && typeof v === 'object' ? { key, value: v.value, about: v.about || '', secret: !!v.secret } : { key, value: v, about: '', secret: false }
  );
}

/** Domanda per un parametro incerto: probabilita' di "nessuno" e i campi candidati ancora liberi
 *  (se "nessuno" domina se ne mostrano di piu', cosi' Claude puo' rispondere senza rileggere la pagina). */
function question(p, r, extra = '', taken = new Set()) {
  const probs = r.probs || [];
  const none = probs.find((x) => x.key === null);
  const n = none && none.p >= 0.5 ? 5 : 3;
  const cands = probs.filter((x) => x.key !== null && !taken.has(x.key)).slice(0, n);
  const alts = [...(none && none.p >= 0.01 ? [{ none: true, p: none.p }] : []), ...cands]
    .sort((x, y) => y.p - x.p)
    .map((x) => (x.none ? `nessuno ${pct(x.p)}` : `${x.key} "${x.data.f ? x.data.f.name : ''}" ${pct(x.p)}`))
    .join(' · ');
  return `? "${p.key}": ${alts}${extra}`;
}

/** Parametri che per nome sono credenziali o dati di pagamento: mai compilati da Claude. */
const SECRET_KEY = /\b(password|passwd|pwd|passphrase|pin|otp|cvv|cvc|iban|numero (di )?carta|carta di credito|card ?number|credit card|kennwort|passwort|mot de passe|contrasena|senha|codice (di )?sicurezza)\b/;

/** Attende che un menu dipendente si riempia (opzioni compatibili col valore), massimo ~3 s. */
async function waitOptions(S, page, id, value) {
  for (let k = 0; k < 40; k++) {
    const snap = await S.collect();
    const it = snap.items.find((i) => i.id === id);
    if (it && !it.flags.includes('off') && it.gx && it.gx.opts && Math.max(0, ...it.gx.opts.map((o) => optionScore(value, o))) >= 0.6) return { snap, it };
    await page.waitForTimeout(75);
  }
  const snap = await S.collect();
  return { snap, it: snap.items.find((i) => i.id === id) };
}

/** Suggerimenti visibili di un autocompletamento. Arrivano dalla rete (anche 1-3 s su un motore voli): si attende fino a ~4 s
 *  e, appena compaiono, si rilegge dopo un attimo perche' la lista e' completa solo quando smette di cambiare. */
async function suggestions(S, page) {
  const read = async () => {
    const loc = page.locator(S.PICK_SEL).filter({ visible: true });
    // un solo giro verso il browser invece di count() + innerText() per ogni suggerimento
    const all = await loc.allInnerTexts().catch(() => []);
    const texts = all.slice(0, 30).map((t) => t.replace(/\s+/g, ' ').trim());
    return { loc, texts };
  };
  // appena compaiono, si attende che il DOM resti fermo ~100 ms (lista completa) invece di una pausa fissa
  const quiet = async () => {
    for (let k = 0; k < 8; k++) {
      const age = await page.mainFrame().evaluate(() => (window.__cbMut ? performance.now() - window.__cbMut : 1e9)).catch(() => 1e9);
      if (age >= 100) return;
      await page.waitForTimeout(Math.max(20, Math.min(60, 100 - age)));
    }
  };
  for (let k = 0; k < 60; k++) {
    let cur = await read();
    if (cur.texts.length) {
      await quiet();
      const again = await read();
      if (again.texts.length >= cur.texts.length) cur = again;
      return cur;
    }
    await page.waitForTimeout(65);
  }
  return { loc: null, texts: [] };
}

/** Data in piu' campi: ogni parte (giorno, mese, anno, ore, minuti) nel suo menu o campo di testo. */
async function fillDateParts(S, page, snap, st) {
  const { p, f } = st;
  const v = parseDateTime(p.value);
  if (!v) return { error: `"${p.value}" non e' una data` };
  const want = { d: v.d, mo: v.mo, y: v.y, h: v.h, mi: v.mi };
  const shown = [];
  const notes = [];
  const ids = [];
  for (const { part, it: orig } of f.parts) {
    if (want[part] === undefined) continue;
    snap = await S.freshSnap(snap, page);
    const it = snap.items.find((i) => i.id === orig.id);
    if (!it) return { error: `${orig.id} (parte ${part}) non piu' presente` };
    const n = want[part];
    if (it.role === 'sel') {
      const opts = (it.gx && it.gx.opts) || [];
      const val = (o) => (part === 'mo' ? monthOf(o) : /^\s*\d{1,4}\s*$/.test(o) ? parseInt(o, 10) : null);
      let idx = opts.findIndex((o) => val(o) === n || (part === 'y' && /^\s*\d{2}\s*$/.test(o) && val(o) === n % 100));
      if (idx < 0 && part === 'mi') {
        // minuti a passi (00, 15, 30, 45): il piu' vicino
        let best = Infinity;
        opts.forEach((o, i) => {
          const x = val(o);
          if (x !== null && Math.abs(x - n) < best) [best, idx] = [Math.abs(x - n), i];
        });
        if (idx >= 0) notes.push(`minuti ${opts[idx]} invece di ${n}`);
      }
      if (idx < 0) return { error: `${it.id} "${it.name}": nessuna opzione per ${n}` };
      await S.step('select', { select: it.id, option: opts[idx] }, snap, page);
      shown.push(opts[idx]);
    } else {
      const ph = fold((it.gx && it.gx.ph) || '');
      const text = part === 'y' ? (/^(yy|aa|jj)$/.test(ph) ? String(n % 100).padStart(2, '0') : String(n)) : String(n).padStart(2, '0');
      await S.step('fill', { fill: it.id, text }, snap, page);
      shown.push(text);
    }
    ids.push(it.id);
  }
  return { ok: true, id: ids[0], ids, note: `"${p.key}" → ${f.name}: ${shown.join(' | ')}${notes.length ? ' (' + notes.join(', ') + ')' : ''}` };
}

/** Esegue un parametro gia' abbinato. Restituisce { ok, note } oppure { ask } oppure { error }. */
async function fillOne(S, page, snap, st, ctx) {
  const { p, f } = st;
  const shown = p.secret ? '••••' : JSON.stringify(String(p.value)).slice(0, 50);
  const item = (id) => snap.items.find((i) => i.id === id);
  // gruppo di radio: sceglie l'opzione dal valore
  if (f.kind === 'radio') {
    const r = choice(f.items.map((it) => ({ key: it.id, logit: 8 * similarity(String(p.value), it.name), data: it })), { none: 4 });
    if (decide(r, ctx.preset) !== 'act') return { ask: `? "${p.key}"=${shown}: ${r.probs.slice(0, 3).map((x) => (x.key ? `${x.key} "${x.data.name}" ${pct(x.p)}` : `nessuno ${pct(x.p)}`)).join(' · ')}` };
    await S.step('check', { check: r.choice, confirm: true }, snap, page);
    return { ok: true, id: r.choice, note: r.confidence < 0.97 ? `"${p.key}" → ${r.choice} "${r.data.name}" ${pct(r.confidence)}` : '' };
  }
  if (f.kind === 'dateparts') return fillDateParts(S, page, snap, st);
  const it = item(f.id) || f.item;
  if (!it) return { error: `${f.id} non piu' presente` };
  if (it.s === 'x') return { error: `!x ${it.id} "${it.name}": campo riservato, lo inserisce l'utente nella finestra` };
  const kind = valueKind(p.value);
  switch (it.role) {
    case 'chk':
    case 'sw':
    case 'rad': {
      const want = truthy(p.value);
      if (want && it.s === 'c' && !ctx.allowIrrev) return { ask: `? "${p.key}" → ${it.id} "${it.name}" !c: serve l'ok dell'utente, poi ripeti con confirm: true` };
      const r = await S.step('check', { check: it.id, on: want, confirm: true }, snap, page);
      return { ok: true, id: it.id, note: r && r.note ? r.note : '' };
    }
    case 'sel': {
      let cur = it;
      if (cur.flags.includes('off') || !(cur.gx && cur.gx.opts && cur.gx.opts.some((o) => optionScore(p.value, o) >= 0.6))) ({ it: cur, snap } = await waitOptions(S, page, it.id, p.value));
      const opts = (cur && cur.gx && cur.gx.opts) || [];
      const r = chooseOption(String(p.value), opts);
      if (decide(r, ctx.preset) !== 'act') return { ask: `? "${p.key}"=${shown} in ${it.id} "${it.name}": ${r.probs.slice(0, 3).map((x) => (x.key === null ? `nessuna ${pct(x.p)}` : `"${x.data}" ${pct(x.p)}`)).join(' · ')}` };
      await S.step('select', { select: it.id, option: opts[r.choice] }, snap, page);
      const chosen = opts[r.choice];
      return { ok: true, id: it.id, note: fold(chosen) !== fold(p.value) ? `"${p.key}" → ${it.id} "${it.name}" ="${chosen}"${r.confidence < 0.97 ? ' ' + pct(r.confidence) : ''}` : '' };
    }
    case 'combo': {
      await S.step('type', { type: it.id, text: String(p.value) }, snap, page);
      const sug = await suggestions(S, page);
      // un popup lasciato aperto nasconde gli altri campi: lo si chiude (Esc) quando non si sceglie nulla
      const closePopup = () => page.keyboard.press('Escape').catch(() => {});
      if (!sug.texts.length) {
        // se il campo ha aperto una finestra, il testo non e' stato confermato: non si dichiara riuscito
        const inDialog = await page.evaluate(() => !!(document.activeElement && document.activeElement.closest('[role=dialog],dialog,[aria-modal=true]'))).catch(() => false);
        if (inDialog) {
          await closePopup();
          return { error: `${it.id}: nessun suggerimento per "${p.value}" (finestra chiusa senza scegliere)` };
        }
        return { ok: true, id: it.id, note: `"${p.key}" → ${it.id}: nessun suggerimento, lasciato il testo digitato` };
      }
      let idx;
      let tieNote = '';
      if (p.pick) {
        // risposta dell'utente a una domanda precedente: testo (anche parziale) del suggerimento
        const w = fold(p.pick);
        idx = sug.texts.findIndex((t) => fold(t) === w);
        if (idx < 0) idx = sug.texts.findIndex((t) => fold(t).includes(w));
        if (idx < 0) {
          await closePopup();
          return { ask: `? "${p.key}": nessun suggerimento contiene "${p.pick}" (disponibili: ${sug.texts.slice(0, 4).map((t) => `"${t}"`).join(' · ')})` };
        }
      } else {
        const r = chooseOption(String(p.value), sug.texts);
        idx = r.choice;
        if (decide(r, ctx.preset) !== 'act') {
          // piu' suggerimenti ugualmente buoni ("Zurich" → citta', aeroporto, stazione): con il preset autonomo si prende il primo
          const sc = sug.texts.map((t) => optionScore(p.value, t));
          const best = Math.max(...sc);
          const tied = sc.map((s, i) => (s >= best - 0.02 ? i : -1)).filter((i) => i >= 0);
          if (ctx.preset.pickFirstOnTie && best >= 0.85 && tied.length > 1) {
            idx = tied[0];
            tieNote = ` (${tied.length} suggerimenti equivalenti, scelto il primo)`;
          } else {
            await closePopup();
            const alts = r.probs.slice(0, 3).map((x) => (x.key === null ? `nessuno ${pct(x.p)}` : `"${x.data}" ${pct(x.p)}`)).join(' · ');
            return { ask: `? "${p.key}" suggerimenti per ${it.id}: ${alts} · rispondi con answers: {"${p.key}": "testo del suggerimento"}` };
          }
        }
      }
      await sug.loc.nth(idx).click({ timeout: 4000 });
      await S.settle(page, 2500, 120, 150);
      const t = sug.texts[idx];
      return { ok: true, id: it.id, note: fold(t) !== fold(p.value) || tieNote ? `"${p.key}" → ${it.id} suggerimento "${t}"${tieNote}` : '' };
    }
    case 'file': {
      if (!ctx.allowIrrev) return { ask: `? "${p.key}" → ${it.id} caricamento file !c: serve l'ok dell'utente, poi confirm: true` };
      await S.step('upload', { upload: it.id, file: String(p.value), confirm: true }, snap, page);
      return { ok: true, id: it.id, note: '' };
    }
    default: {
      let text = String(p.value);
      let conv = '';
      if (kind === 'date' || it.role === 'date') {
        const t2 = formatDateFor(text, it);
        if (t2 !== text) conv = ` (data adattata: ${t2})`;
        text = t2;
      }
      const r = await S.step('fill', { fill: it.id, text }, snap, page);
      const note = r && r.note ? r.note : '';
      return { ok: true, id: it.id, fill: true, note: note || (conv ? `"${p.key}" → ${it.id} "${it.name}"${conv}` : '') };
    }
  }
}

export async function runTask(S, a) {
  const preset = PRESETS[a.confidence] || PRESETS.balanced;
  const ctx = { preset, allowIrrev: a.confirm === true };
  let page = await S.ensure();
  const head = [];
  const asks = [];
  const notes = [];
  if (a.url) {
    const u = S.checkUrl(a.url);
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await S.settle(page, 8000, 250, 300);
    const g = await S.humanGate(page);
    page = g.page;
    if (g.note) notes.push(g.note);
    if (g.stuck) return 'compito fermo: ' + g.note;
    const ck = await S.dismissCookies(page);
    if (ck) notes.push(`cookie rifiutati (${ck})`);
  }
  if (a.before && a.before.length) {
    const r = await S.run(a.before, { view: 'none' });
    const m = r.match(/^ok (\d+)\/(\d+)/);
    if (!m || m[1] !== m[2]) return 'compito interrotto nei passi iniziali:\n' + r;
    notes.push(...r.split('\n').slice(1).filter(Boolean));
  }
  page = S.page;
  if (page.url() !== 'about:blank' && !S.allowedUrl(page.url())) throw new Error(`${new URL(page.url()).hostname} e' fuori dai domini consentiti`);
  let snap = await S.collect();
  if (a.url || a.before || !S.last || S.last.page !== page) S.remember(snap);
  const startUrl = page.url();
  const startModal = S.last.modal;
  await page.mainFrame().evaluate(() => { window.__cbAdded = []; }).catch(() => {});
  if (snap.challenge && snap.challenge.block) head.push(`verifica ${snap.challenge.kind} in corso: chiedi all'utente di completarla nella finestra, poi browse_view`);
  else if (snap.captcha) head.push(`CAPTCHA${snap.challenge ? ' ' + snap.challenge.kind : ''} nel modulo: all'invio Colibri aspetta che l'utente lo risolva`);
  if (snap.login) head.push("campo password: l'accesso lo fa l'utente nella finestra del browser");

  // ---- decidi: abbinamento parametri -> campi (domande "choice" con confidenza) ----
  const params = normParams(a.params);
  const host = (() => {
    try {
      return new URL(page.url()).hostname;
    } catch {
      return '';
    }
  })();
  const memory = loadMemory(S)[host] || {};
  const errors = [];
  const fields = fieldsFrom(snap.items, snap.regions);
  const fixed = [];
  const learned = [];
  const toGround = [];
  for (const p of params) {
    if (SECRET_KEY.test(fold(p.key + ' ' + p.about))) {
      errors.push(`✗ "${p.key}": campo riservato (!x), lo inserisce l'utente nella finestra`);
      continue;
    }
    // risposta a una domanda sui suggerimenti: testo del suggerimento da scegliere (non un riferimento)
    const ans = a.answers && a.answers[p.key];
    if (ans && !isRef(ans)) p.pick = String(ans);
    const ref = isRef(p.key) ? p.key : ans && isRef(ans) ? ans : null;
    if (ref) {
      const f = (parseDateTime(p.value) && fields.find((x) => x.kind === 'dateparts' && x.parts.some((q) => q.it.id === ref))) || fields.find((x) => x.id === ref || (x.items && x.items.some((i) => i.id === ref)));
      if (!f) {
        asks.push(`? "${p.key}": ${ref} non trovato nella pagina`);
        continue;
      }
      if (!isRef(p.key)) learned.push([p.key, f.name]);
      fixed.push({ p, f, conf: 1 });
      continue;
    }
    toGround.push(p);
  }
  const { acts, asks: unsure, taken } = assign(toGround, fields, { memory, preset, fixed });
  for (const [p, r, extra] of unsure) asks.push(question(p, r, extra, taken));
  const order = new Map(snap.items.map((it, i) => [it.id, i]));
  const firstId = (f) => (f.kind === 'dateparts' ? f.parts[0].it.id : f.id);
  const todo = [...acts].sort((x, y) => (order.get(firstId(x.f)) ?? 0) - (order.get(firstId(y.f)) ?? 0));

  // ---- agisci + verifica ----
  const touched = new Map();
  let ok = 0;
  for (const st of todo) {
    snap = await S.freshSnap(snap, page);
    // dopo la scelta di un suggerimento molti siti ricostruiscono la pagina: i riferimenti dei campi successivi non
    // esistono piu'. Il campo si ritrova per nome nella pagina nuova invece di fallire.
    const here = (f) => (f.kind === 'radio' ? f.items.some((x) => snap.items.some((i) => i.id === x.id)) : f.kind === 'dateparts' ? f.parts.every((x) => snap.items.some((i) => i.id === x.it.id)) : snap.items.some((i) => i.id === f.id));
    if (!here(st.f)) {
      const r2 = groundParam(st.p, fieldsFrom(snap.items, snap.regions), memory);
      if (decide(r2, preset) === 'act') st.f = r2.data.f;
      else {
        asks.push(question(st.p, r2, ' (la pagina e\' cambiata)', taken));
        continue;
      }
    }
    try {
      const r = await fillOne(S, page, snap, st, ctx);
      if (r.ask) asks.push(r.ask);
      else if (r.error) errors.push(`✗ "${st.p.key}": ${r.error}`);
      else {
        ok++;
        if (r.fill || /^(chk|sw|rad)$/.test(st.f.role) || st.f.kind === 'radio') touched.set(r.id, 'fill');
        for (const id of r.ids || []) touched.set(id, 'fill');
        // nota solo per gli abbinamenti non ovvi: etichetta diversa dalla chiave o confidenza non alta
        const obvious = st.conf >= 0.9 && st.r && st.r.data && st.r.data.name >= 0.95;
        const conf = st.conf < 0.97 && !obvious && !r.note ? `"${st.p.key}" → ${st.f.id} "${st.f.name}" ${pct(st.conf)}` : '';
        if (r.note || conf) notes.push(r.note || conf);
      }
    } catch (e) {
      errors.push(`✗ "${st.p.key}" → ${st.f.id}: ${firstLine(e)}`);
    }
    page = S.page;
  }
  saveMemory(S, host, learned);
  if (params.length) head.push(`parametri: ${ok}/${params.length} impostati${asks.length ? `, ${asks.length} da chiarire` : ''}${errors.length ? `, ${errors.length} errori` : ''}`);

  // ---- valuta: campi obbligatori vuoti e non validi ----
  snap = await S.collect();
  const emptySel = (i) => i.role === 'sel' && (!i.value || /^(seleziona|scegli|select|choose|choisir|elegir|auswahl|--)/.test(fold(i.value)));
  const missing = snap.items.filter((i) => i.flags.includes('req') && !i.flags.includes('off') && ((/^(text|area|num|date|combo|edit)$/.test(i.role) && !i.value) || emptySel(i) || (i.role === 'chk' && i.checked === false)));
  const groupsReq = new Set();

  // ---- invio (gated) ----
  if (a.submit) {
    const targets = a.submit === true ? [true] : [].concat(a.submit);
    let blocked = '';
    if (asks.length || errors.length) blocked = 'invio non eseguito: prima chiarisci i punti sopra';
    else if (missing.length) blocked = `invio non eseguito: campi obbligatori vuoti ${missing.slice(0, 6).map((i) => `${i.id} "${i.name}"`).join(', ')}`;
    for (const t of blocked ? [] : targets) {
      snap = await S.freshSnap(snap, page);
      let it;
      if (t === true) {
        const btns = snap.items.filter((i) => i.role === 'btn' && i.inForm && !(snap.regions[i.reg] && snap.regions[i.reg].low));
        const r = choice(btns.map((b) => ({ key: b.id, logit: 3 + (b.s === 'c' ? 0.5 : 0) + (/(avanti|invia|conferm|next|submit|send|continua|prosegui|suivant|enviar|weiter)/.test(fold(b.name)) ? 2 : 0) - (/(annulla|cancel|reset|azzera|bozza|indietro|back)/.test(fold(b.name)) ? 3 : 0), data: b })), { none: 2 });
        it = r.data;
        if (!it || decide(r, preset) !== 'act') {
          blocked = `invio: pulsante incerto (${r.probs.slice(0, 3).map((x) => (x.key ? `${x.key} "${x.data.name}" ${pct(x.p)}` : `nessuno ${pct(x.p)}`)).join(' · ')})`;
          break;
        }
      } else {
        const res = S.resolve(snap, t);
        if (res.err) {
          blocked = `invio: ${res.err}`;
          break;
        }
        it = res.it;
        if (res.note) notes.push(res.note);
      }
      if (it.s === 'c' && !ctx.allowIrrev) {
        blocked = `!c ${it.id} "${it.name}": invio irreversibile, serve l'ok dell'utente e poi confirm: true`;
        break;
      }
      try {
        const r = await S.step('click', { click: it.id, confirm: true }, snap, page);
        if (r && r.block) {
          blocked = `invio non eseguito: ${r.block}`;
          break;
        }
        if (r && r.note) notes.push(r.note);
        if (S.newPages.length) {
          const np = S.newPages.filter((x) => !x.isClosed()).pop();
          S.newPages = [];
          if (np) {
            await np.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            S.page = np;
            notes.push(`aperta nuova scheda (${np.url()})`);
          }
        }
        page = S.page;
      } catch (e) {
        blocked = `invio ${it.id}: ${firstLine(e)}`;
        break;
      }
    }
    if (blocked) head.push(blocked);
    else head.push(`inviato: ${targets.map((t) => (t === true ? 'modulo' : typeof t === 'string' ? `"${t}"` : 'ok')).join(' → ')}`);
  } else if (missing.length && params.length) {
    head.push(`obbligatori ancora vuoti: ${missing.slice(0, 8).map((i) => `${i.id} "${i.name}"${i.s ? ' !' + i.s : ''}`).join(', ')}`);
  }
  void groupsReq;

  // ---- verifica dell'esito (domanda "noul" deterministica) ----
  if (a.expect) {
    const found = await page
      .getByText(String(a.expect))
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    head.push(`atteso "${a.expect}": ${found ? 'si' : 'NO'}`);
  }

  // ---- estrazione tipizzata (scelta con confidenza; conti nel codice) ----
  const extracted = [];
  if (a.extract && Object.keys(a.extract).length) {
    let pg = { pairs: [], lines: [], tables: [] };
    try {
      pg = JSON.parse(await page.mainFrame().evaluate(P.pairsInPage, {}));
    } catch {}
    for (const [key, type] of Object.entries(a.extract)) {
      const r = extractField({ key, type }, pg);
      if (r.value === null || r.value === undefined) extracted.push(`${key}: non trovato`);
      else if (type === 'table') extracted.push(`${key} (${pct(r.confidence)}):\n${r.value}`);
      else extracted.push(`${key} = ${JSON.stringify(r.value)}${r.confidence < 0.97 ? ` (${pct(r.confidence)}, da ${r.from})` : ''}`);
    }
  }
  if (a.read) {
    try {
      const mode = ['table', 'cards'].includes(a.read) ? a.read : 'text';
      notes.push({ table: 'tabella:\n', cards: 'schede:\n', text: 'testo:\n' }[mode] + (await S.read({ mode })));
    } catch (e) {
      notes.push('lettura: ' + firstLine(e));
    }
  }
  if (S.pending.size) await Promise.race([Promise.all([...S.pending]), new Promise((r) => setTimeout(r, 15000))]);

  // ---- stato della pagina ----
  page = S.page;
  const after = await S.collect();
  S.stats.observations++;
  let body = '';
  const view = a.view || 'auto';
  const navigated = page.url() !== startUrl || S.last.page !== page;
  if (view === 'full' || (view === 'auto' && (navigated || after.modal !== startModal))) {
    body = (navigated ? 'pagina cambiata\n' : '') + renderView(after, { url: page.url(), tabs: S.tabs(), max: S.cfg.maxItems });
  } else if (view === 'auto') {
    let fresh = [];
    try {
      fresh = await page.mainFrame().evaluate(P.addedTextInPage, 4);
    } catch {}
    const known = new Set([...after.alerts, ...after.items.map((i) => i.name)]);
    fresh = fresh.filter((t) => !known.has(t) && !after.alerts.some((x) => x.includes(t) || t.includes(x)));
    if ((a.url || a.before) && !(params.length || a.submit || a.extract || a.read || a.expect)) {
      // solo apertura/navigazione: Claude vuole vedere la pagina
      body = renderView(after, { url: page.url(), tabs: S.tabs(), max: S.cfg.maxItems });
    } else if (a.url || a.before) {
      // Claude non ha ancora visto la pagina: riepilogo minimo (avvisi, pulsanti dei moduli)
      const btns = after.items.filter((i) => i.role === 'btn' && i.inForm && !(after.regions[i.reg] && after.regions[i.reg].low));
      body = [`${shortUrl(page.url())} | ${after.meta ? after.meta.title : ''}`, ...after.alerts.map((x) => '! ' + x), ...fresh.map((t) => '» ' + t), btns.length ? 'pulsanti: ' + btns.map((b) => `${b.id} "${b.name}"${b.s ? ' !' + b.s : ''}`).join(' · ') : ''].filter(Boolean).join('\n');
    } else body = renderDiff(S.last.prev, after, { url: page.url(), tabs: S.tabs(), touched, fresh }) || renderView(after, { url: page.url(), tabs: S.tabs(), max: S.cfg.maxItems });
  }
  S.remember(after);
  const lines = [...head, ...errors, ...asks];
  if (asks.length) lines.push('rispondi con answers: {"parametro": "ref"} per un campo (ricordato per questo sito) o {"parametro": "testo del suggerimento"} per un autocompletamento, oppure usa browse_do');
  lines.push(...notes, ...S.events.splice(0), ...extracted);
  return lines.join('\n') + (body ? '\n---\n' + body : '');
}
