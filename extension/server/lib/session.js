import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import * as P from './page-script.js';
import { renderView, renderDiff, snapKeys, lineOf, estTokens, readCover, filterAlts, matchesFilter } from './render.js';
import { fold, similarity, choice, decide, PRESETS } from './engine.js';
import { runTask } from './task.js';
import { cdpAlive, launchRealChrome } from './realchrome.js';
import { pdfText } from './pdf.js';

const clean = (v) => (typeof v === 'string' && !v.startsWith('${') ? v.trim() : '');
const list = (s) =>
  clean(s)
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, ''))
    .filter(Boolean);
const yes = (v, def) => {
  const c = clean(v);
  if (!c) return def;
  return /^(1|true|yes|si|sì|on)$/i.test(c);
};
// evaluate con tempo massimo: alcuni iframe (es. about:blank con frammento, frame mai inizializzati) non rispondono mai
const evalIn = (f, fn, arg, ms = 2500) => {
  let t;
  return Promise.race([f.evaluate(fn, arg), new Promise((_, rej) => (t = setTimeout(() => rej(new Error('frame non risponde')), ms)))]).finally(() => clearTimeout(t));
};
const firstLine = (e) => String((e && e.message) || e).split('\n')[0].replace(/^\w+Error: /, '').slice(0, 220);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const within = (p, ms, msg = 'tempo scaduto') => {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(msg)), ms)))]).finally(() => clearTimeout(t));
};
// scheda o collegamento rotti (CDP fuori sincrono, renderer bloccato): si ripristina con una scheda nuova
export const BROKEN = /No frame with given id|Target page, context or browser has been closed|Target closed|Target crashed|Page crashed|Session closed|browser has been disconnected|frame non risponde|pagina non risponde/i;
// parametri che servono solo a tracciare chi clicca: l'URL resta lo stesso senza
const TRACK_PARAM = /^(utm_\w+|gclid|gclsrc|gbraid|wbraid|dclid|fbclid|msclkid|yclid|twclid|ttclid|li_fat_id|mc_cid|mc_eid|_hsenc|_hsmi|igshid|srsltid|_gl|oly_anon_id|oly_enc_id|vero_id|mkt_tok)$/i;
const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};
// reti pubblicitarie e di affiliazione: le schede che restano li' non servono a chi naviga
const JUNK_HOST = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|awin1\.com|tradedoubler\.com|zanox\.com|webgains\.com|clickbank\.net|redirectingat\.com|skimresources\.com|tradetracker\.net|prf\.hn|linksynergy\.com|anrdoezrs\.net|dpbolvw\.net|jdoqocy\.com|kqzyfj\.com|tkqlhce\.com|go2cloud\.org|sjv\.io|pxf\.io|taboola\.com|outbrain\.com|criteo\.com|adnxs\.com|admitad\.com|kelkoogroup\.net)$|^(track|tracking|click|clicks|redirect|adclick)\./i;
export const isJunkUrl = (u) => !u || u === 'about:blank' || JUNK_HOST.test(hostOf(u));

const eur = (n) => n.toFixed(2).replace('.', ',') + '€';

/** Schede filtrate, ordinate e paginate lato server: si legge solo cio' che serve. */
export function cardsOut(r, { offset = 0, max = 20, sort, filter, maxPrice } = {}) {
  let items = r.items;
  const how = [];
  if (filter) {
    const words = String(filter).replace(/\s*\|\s*/g, '|').split(/\s+/).filter(Boolean);
    // "a|b" dentro una parola: basta una delle alternative
    const alts = (w) => w.split('|').map((x) => fold(x).trim()).filter(Boolean);
    const inc = words.filter((w) => !w.startsWith('-')).map(alts).filter((a) => a.length);
    const exc = words.filter((w) => w.startsWith('-') && w.length > 1).flatMap((w) => alts(w.slice(1)));
    items = items.filter((it) => {
      const f = fold(it.row);
      return inc.every((a) => a.some((w) => f.includes(w))) && !exc.some((w) => f.includes(w));
    });
    how.push(`filtro "${filter}"`);
  }
  if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
    items = items.filter((it) => it.t !== null && it.t !== undefined && it.t <= Number(maxPrice));
    how.push(`max ${eur(Number(maxPrice))}`);
  }
  if (sort === 'price' || sort === '-price') {
    const d = sort === 'price' ? 1 : -1;
    items = [...items].sort((a, b) => (a.t === null) - (b.t === null) || d * ((a.t || 0) - (b.t || 0)));
    how.push(`per prezzo totale ${d > 0 ? 'crescente' : 'decrescente'}`);
  }
  const tag = `${r.sel}${how.length ? '; ' + how.join(', ') : ''}`;
  if (!items.length) return `nessuna scheda corrisponde su ${r.total} (${tag})`;
  const part = items.slice(offset, offset + max);
  const more = items.length - offset - part.length;
  const of = items.length !== r.total ? `${items.length} (filtrate da ${r.total})` : `${r.total}`;
  return (
    `schede ${offset + 1}-${offset + part.length} di ${of} (${tag})\n` +
    (r.common && r.common.length ? `in tutte: ${r.common.join(' · ')}\n` : '') +
    part.map((it) => it.row).join('\n') +
    (more > 0 ? `\n… altre ${more} (offset:${offset + part.length})` : '')
  );
}

const PRICE_KEY = /^(prezzo|price|costo|cost|prix|preis|precio)( totale| total)?$|^(totale|total)$|^(spedizione|sped|shipping|consegna|versand)$|prezzo (di )?riferimento|prezzo consigliato|listino/;
const DIMS = [
  [/^(larghezza|width|breite|largeur|ancho)\b/, 'L'],
  [/^(altezza|height|hohe|hauteur|alto)\b/, 'A'],
  [/^(profondita|depth|tiefe|profondeur|fondo)\b/, 'P'],
];

/** Valore di una chiave nella scheda tecnica: etichetta uguale, contenuta o simile. */
export function fieldOf(d, key) {
  const fk = fold(key).replace(/\s+/g, ' ').trim();
  if (d.price && PRICE_KEY.test(fk)) {
    const p = d.price;
    if (/sped|shipping|consegna|versand/.test(fk)) return p.ship === null ? null : p.ship ? eur(p.ship) : 'gratis';
    if (/riferimento|consigliato|listino/.test(fk)) return p.ref === null ? null : `${eur(p.ref)} ${p.refKind} (non verificato)`;
    if (/total/.test(fk)) return p.tot !== null ? eur(p.tot) : p.price !== null ? eur(p.price) : null;
    if (p.price !== null) {
      let s = eur(p.price);
      if (p.ship === 0) s += ' (sped gratis)';
      else if (p.tot !== null) s += ` (tot ${eur(p.tot)} con sped ${eur(p.ship)})`;
      if (p.ref !== null) s += ` | rif ${eur(p.ref)} ${p.refKind} -${Math.round((1 - p.price / p.ref) * 100)}%`;
      if (p.cond.length) s += ` | cond:"${p.cond.join('; ')}" non confermato`;
      return s;
    }
  }
  let best = null;
  for (const [l, v] of d.pairs) {
    const fl = fold(l).replace(/\s+/g, ' ').trim();
    let sc = 0;
    if (fl === fk) sc = 3;
    else if ((' ' + fl + ' ').includes(' ' + fk + ' ')) sc = 2 + 1 / (1 + fl.length);
    else if (fk.length >= 4 && fl.includes(fk)) sc = 1.5 + 1 / (1 + fl.length);
    else {
      const s = similarity(fk, fl);
      if (s >= 0.8) sc = s;
    }
    if (sc && (!best || sc > best.sc)) best = { sc, v };
  }
  if (best) return best.v;
  if (/^(dimensioni|dimensions|misure|abmessungen|ingombro)/.test(fk)) {
    const got = [];
    for (const [re, tag] of DIMS) {
      const hit = d.pairs.find(([l]) => re.test(fold(l).trim()));
      if (hit) got.push(`${tag} ${hit[1]}`);
    }
    if (got.length >= 2) return got.join(' x ');
  }
  return null;
}

// codice del modello nel titolo (lettere e cifre): serve a riconoscere lo stesso prodotto su siti diversi
const modelTokens = (title) => [...new Set((String(title).match(/[A-Za-z0-9][A-Za-z0-9-]{4,}/g) || []).filter((t) => /\d/.test(t) && /[A-Za-z]/.test(t)).map((t) => t.toUpperCase().replace(/-/g, '')))];

/** Testo con i ref tolti: le schede lette in una scheda di sfondo non hanno elementi cliccabili. */
const noRefs = (s) => s.replace(/ →\S+/g, '').replace(/\[[a-z]?\d*e\d+\]( \| )?/g, '').replace(/\[[a-z]?\d*e\d+ ([^\]]*)\]/g, '$1');

export function loadConfig(env = process.env) {
  const home = os.homedir();
  const dl = path.join(home, 'Downloads');
  // cartella delle versioni precedenti al nome Colibri: se esiste si tiene, per non perdere gli accessi fatti
  const legacy = path.join(home, '.compact-browser');
  const base = fs.existsSync(legacy) ? legacy : path.join(home, '.colibri');
  return {
    mode: clean(env.CB_MODE) === 'cdp' ? 'cdp' : 'launch',
    cdpUrl: clean(env.CB_CDP_URL) || 'http://127.0.0.1:9222',
    chromePath: clean(env.CB_CHROME_PATH),
    profileDir: clean(env.CB_PROFILE_DIR) || path.join(base, 'profile'),
    realProfileDir: clean(env.CB_REAL_PROFILE_DIR) || path.join(base, 'real-chrome'),
    // modalita' cdp: se nessun Chrome e' in ascolto in locale, Colibri avvia il Chrome reale da solo
    autoChrome: yes(env.CB_AUTO_CHROME, true),
    downloadsDir: clean(env.CB_DOWNLOADS_DIR) || (fs.existsSync(dl) ? dl : path.join(base, 'downloads')),
    headless: yes(env.CB_HEADLESS, false),
    allowed: list(env.CB_ALLOWED_DOMAINS),
    confirmSensitive: yes(env.CB_CONFIRM_SENSITIVE, true),
    allowScreenshot: yes(env.CB_ALLOW_SCREENSHOT, true),
    rejectCookies: yes(env.CB_REJECT_COOKIES, true),
    closePopups: yes(env.CB_CLOSE_POPUPS, true),
    stripTracking: yes(env.CB_STRIP_TRACKING, true),
    maxItems: Math.max(20, parseInt(clean(env.CB_MAX_ITEMS) || '120', 10) || 120),
    extraArgs: clean(env.CB_EXTRA_ARGS) ? clean(env.CB_EXTRA_ARGS).split(/\s+/) : [],
    // secondi di attesa quando compare un CAPTCHA o una verifica anti-bot (0 = non aspettare)
    humanWait: Math.max(0, parseInt(clean(env.CB_HUMAN_WAIT) || '50', 10) || 0),
    humanShow: yes(env.CB_HUMAN_SHOW, true),
    // pagine di ricerca per browse_search ({q} = testo cercato), in ordine: se una chiede una verifica si passa alla successiva.
    // DuckDuckGo HTML non chiede CAPTCHA come Google; Bing come riserva (DuckDuckGo blocca spesso Chrome senza finestra)
    searchUrls: clean(env.CB_SEARCH_URL) ? clean(env.CB_SEARCH_URL).split(/\s+/) : ['https://html.duckduckgo.com/html/?q={q}', 'https://www.bing.com/search?q={q}'],
  };
}

const ACTIONS = ['click', 'fill', 'type', 'select', 'check', 'press', 'pick', 'hover', 'scroll', 'wait', 'waitFor', 'goto', 'back', 'tab', 'upload', 'dialog', 'find', 'read'];
const PICK_SEL = [
  '[role=option]', '[role=listbox] li', '.ui-menu-item', '.autocomplete-suggestion', '.tt-suggestion', '.pac-item',
  '.select2-results__option', '.mat-option', '.mat-mdc-option', '.ng-option', '.dropdown-item', '.choices__item--choice',
  '.awesomplete li', '.typeahead li', 'datalist option',
].map((s) => s + ':visible').join(',');

export class Session {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
    this.browser = null;
    this.page = null;
    this.launching = null;
    this.hooked = new WeakSet();
    this.crashed = new WeakSet();
    this.frameIds = new WeakMap();
    this.frameN = 0;
    this.idN = 0;
    this.newPages = [];
    this.bornAt = new WeakMap();
    this.owned = new Set();
    this.refInfo = new Map();
    this.acting = false;
    this.events = [];
    this.pending = new Set();
    this.net = new WeakMap();
    this.navAt = new WeakMap();
    // schede aperte da Colibri per conto suo (ricerche, letture di sfondo, ripristino): non sono popup da adottare
    this.internal = new WeakSet();
    this.bgBusy = 0;
    this.bgQueue = [];
    this.inUse = new Set();
    // pagine appena lette: testo, coppie etichetta-valore, schede; valgono 10 minuti
    this.cache = new Map();
    // valori letti con mode "fields" per l'avviso di incoerenza tra fonti
    this.facts = [];
    this.dialogAccept = false;
    this.last = null; // { page, url, modal, keys }
    this.PICK_SEL = PICK_SEL;
    this.stats = { calls: 0, chars: 0, actions: 0, observations: 0, shots: 0, shotTokens: 0, toolMs: 0, vw: 1280, vh: 800 };
  }

  // ---------- avvio e gestione browser ----------
  async ensure() {
    if (this.page && this.crashed.has(this.page)) {
      this.events.push('la scheda era andata in crash: riaperta sulla stessa pagina');
      return this.recover();
    }
    if (this.ctx && this.page && !this.page.isClosed()) return this.page;
    if (this.ctx) {
      const pages = this.ctx.pages().filter((p) => !p.isClosed() && !this.inUse.has(p));
      this.page = pages[pages.length - 1];
      if (!this.page) {
        this.page = await within(this.ctx.newPage(), 10000, 'il browser non risponde');
        this.owned.add(this.page);
        this.internal.add(this.page);
      }
      this.hook(this.page);
      return this.page;
    }
    if (!this.launching) this.launching = this.launch().finally(() => (this.launching = null));
    await this.launching;
    return this.page;
  }

  async launch() {
    const c = this.cfg;
    if (c.mode === 'cdp') {
      const connect = () => chromium.connectOverCDP(c.cdpUrl, { timeout: 8000 });
      try {
        // un Chrome appena avviato dall'utente puo' metterci un attimo ad aprire la porta: si ricontrolla prima di avviarne uno
        let alive = await cdpAlive(c.cdpUrl);
        for (let k = 0; !alive && k < 3; k++) {
          await new Promise((r) => setTimeout(r, 500));
          alive = await cdpAlive(c.cdpUrl);
        }
        if (c.autoChrome && !alive) {
          await launchRealChrome({ cdpUrl: c.cdpUrl, chromePath: c.chromePath, profileDir: c.realProfileDir });
          this.events.push(`avviato Chrome reale (porta di debug, profilo ${c.realProfileDir}): resta aperto anche quando Colibri si chiude`);
        }
        this.browser = await connect();
      } catch (e) {
        throw new Error(`Nessun Chrome in ascolto su ${c.cdpUrl}. Avvialo con: npx -y github:t4zxxx1/colibri-mcp --chrome (oppure Chrome con --remote-debugging-port e un --user-data-dir dedicato). Dettaglio: ${firstLine(e)}`);
      }
      this.ctx = this.browser.contexts()[0] || (await this.browser.newContext());
      // il Chrome e' dell'utente: si riusa una scheda vuota se c'e', altrimenti se ne apre una e solo quelle aperte
      // da Colibri verranno chiuse all'uscita
      const blank = this.ctx.pages().find((p) => /^(about:blank|chrome:\/\/(newtab|new-tab-page)\/?)$/.test(p.url()));
      if (blank) this.page = blank;
      else {
        this.page = await this.ctx.newPage();
        this.owned.add(this.page);
        this.internal.add(this.page);
      }
      this.browser.on('disconnected', () => this.reset());
    } else {
      fs.mkdirSync(c.profileDir, { recursive: true });
      const base = {
        headless: c.headless,
        viewport: c.headless ? { width: 1280, height: 800 } : null,
        acceptDownloads: true,
        args: ['--no-first-run', '--no-default-browser-check', ...c.extraArgs],
      };
      const tries = c.chromePath ? [{ executablePath: c.chromePath }] : [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
      let err;
      for (const t of tries) {
        try {
          this.ctx = await chromium.launchPersistentContext(c.profileDir, { ...base, ...t });
          break;
        } catch (e) {
          err = e;
          if (/ProcessSingleton|profile.*in use|already running|SingletonLock/i.test(String(e && e.message))) {
            throw new Error(`Il profilo ${c.profileDir} e' gia' aperto da un'altra finestra di Chrome: chiudila e riprova.`);
          }
        }
      }
      if (!this.ctx) throw new Error(`Impossibile avviare Chrome o Edge. Installa Google Chrome oppure indica il percorso nelle impostazioni dell'estensione. Dettaglio: ${firstLine(err)}`);
      this.page = this.ctx.pages()[0] || (await this.ctx.newPage());
    }
    this.ctx.setDefaultTimeout(8000);
    await this.ctx.addInitScript(() => {
      window.__cbMut = performance.now();
      window.__cbAdded = [];
      try {
        new MutationObserver((ms) => {
          window.__cbMut = performance.now();
          const a = window.__cbAdded;
          for (const m of ms) {
            if (m.type === 'childList') for (const n of m.addedNodes) a.push(n);
            else if (m.type === 'characterData') a.push(m.target);
          }
          if (a.length > 600) a.splice(0, a.length - 300);
        }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      } catch {}
    });
    this.ctx.on('close', () => this.reset());
    this.ctx.on('page', (p) => {
      this.hook(p);
      this.newPages.push(p);
      this.bornAt.set(p, Date.now());
      // schede aperte mentre Colibri agisce (popup, target=_blank): sono sue
      if (this.acting) this.owned.add(p);
    });
    for (const p of this.ctx.pages()) this.hook(p);
  }

  reset() {
    this.ctx = null;
    this.page = null;
    this.browser = null;
    this.last = null;
    this.owned = new Set();
  }

  /**
   * Scheda bloccata o non piu' collegata ("No frame with given id", renderer fermo): se ne apre una nuova
   * sulla stessa pagina; se nemmeno il browser risponde ci si ricollega (cdp) o lo si riavvia (launch).
   */
  async recover() {
    const old = this.page;
    let url = '';
    try {
      url = old && !old.isClosed() ? old.url() : '';
    } catch {}
    this.last = null;
    let p = null;
    if (this.ctx) {
      try {
        p = await within(this.ctx.newPage(), 8000);
        this.internal.add(p);
        this.owned.add(p);
        this.hook(p);
        this.page = p;
        // la scheda dell'utente (cdp) resta aperta; le altre si chiudono senza aspettarle
        if (old && old !== p && !old.isClosed() && (this.owned.has(old) || this.cfg.mode !== 'cdp')) within(old.close(), 3000).catch(() => {});
      } catch {
        p = null;
      }
    }
    if (!p) {
      try {
        if (this.cfg.mode === 'cdp') {
          if (this.browser) await within(this.browser.close(), 3000);
        } else if (this.ctx) await within(this.ctx.close(), 5000);
      } catch {}
      this.reset();
      p = await this.ensure();
    }
    if (/^https?:/.test(url)) {
      await within(p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }), 16000).catch(() => {});
      await this.settle(p, 4000, 200).catch(() => {});
    }
    return p;
  }

  /** goto che regge le navigazioni interrotte (pagine che si ricaricano da sole) e le schede scollegate. */
  async nav(page, url, timeout = 30000) {
    for (let k = 0; ; k++) {
      try {
        const resp = await within(page.goto(url, { waitUntil: 'domcontentloaded', timeout }), timeout + 5000, 'pagina non risponde');
        return { page, resp };
      } catch (e) {
        const m = String((e && e.message) || e);
        if (k >= 1 || /download is starting/i.test(m)) throw e;
        if (BROKEN.test(m)) {
          if (page === this.page) page = await this.recover();
          else throw e;
        } else if (/ERR_ABORTED|interrupted by another navigation|frame was detached/i.test(m)) await sleep(600);
        else throw e;
      }
    }
  }

  /** Scheda di sfondo per ricerche e letture indipendenti: al massimo 3 insieme, la pagina attiva non cambia. */
  async bgPage() {
    if (this.bgBusy >= 3) await new Promise((r) => this.bgQueue.push(r));
    this.bgBusy++;
    try {
      await this.ensure();
      const p = await within(this.ctx.newPage(), 10000, 'il browser non risponde');
      this.internal.add(p);
      this.owned.add(p);
      this.inUse.add(p);
      this.hook(p);
      return p;
    } catch (e) {
      this.bgDone();
      throw e;
    }
  }

  async bgClose(p) {
    if (p) this.inUse.delete(p);
    if (p && !p.isClosed()) await within(p.close(), 3000).catch(() => {});
    this.bgDone();
  }

  bgDone() {
    this.bgBusy = Math.max(0, this.bgBusy - 1);
    const next = this.bgQueue.shift();
    if (next) next();
  }

  // schede aperte da un clic: la prima utile diventa attiva, ma solo se l'ha aperta un clic (o tasto) del passo
  // in corso dalla scheda attiva. Le altre (pubblicita' durante un goto, popup di sfondo) restano in sfondo o,
  // se vuote o pubblicitarie e aperte da Colibri, si chiudono.
  async adoptNewPages(act = 'click', from = this.page, since = 0) {
    const list = this.newPages.filter((p) => !p.isClosed() && !this.internal.has(p));
    this.newPages = [];
    const notes = [];
    let keep = null;
    const userAct = /^(click|press|pick)$/.test(act);
    const opener = async (p) => within(p.opener(), 1500).catch(() => null);
    const cands = [];
    for (const p of list) {
      if (!userAct || (this.bornAt.get(p) || 0) < since) continue;
      const o = await opener(p);
      // target=_blank e' noopener per default: opener nullo vale come aperta dalla scheda attiva
      if (o === from || o === null) cands.push(p);
    }
    for (const p of cands) {
      await p.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      // redirect di affiliazione o popup che parte vuoto: si lascia il tempo di arrivare alla pagina vera
      if (isJunkUrl(p.url())) await p.waitForURL((u) => !isJunkUrl(String(u)), { timeout: 4000, waitUntil: 'commit' }).catch(() => {});
    }
    let bg = 0;
    for (const p of list) {
      if (p.isClosed()) continue;
      const junk = isJunkUrl(p.url()) && this.owned.has(p);
      if (cands.includes(p)) {
        if (junk) {
          notes.push(`chiusa scheda inutile (${hostOf(p.url()) || 'vuota'})`);
          await p.close().catch(() => {});
        } else keep = p;
      } else if (junk) await p.close().catch(() => {});
      else bg++;
    }
    if (keep) {
      this.page = keep;
      await keep.bringToFront().catch(() => {});
      notes.push(`aperta nuova scheda, ora attiva (${keep.url()})`);
    } else if (bg) notes.push(`${bg} scheda aperta dalla pagina in sfondo, non attiva (tab:"list" per vederla)`);
    return notes;
  }

  // schede di sfondo aperte da Colibri: via le vuote, le doppie, quelle pubblicitarie e oltre le 3 piu' recenti
  async tidyTabs() {
    if (!this.ctx) return '';
    const bg = this.ctx.pages().filter((p) => !p.isClosed() && p !== this.page && this.owned.has(p) && !this.inUse.has(p));
    const seen = new Set([this.page && this.page.url()]);
    let n = 0;
    for (const p of bg) {
      const u = p.url();
      if (isJunkUrl(u) || seen.has(u)) {
        await p.close().catch(() => {});
        n++;
      } else seen.add(u);
    }
    const rest = bg.filter((p) => !p.isClosed());
    for (const p of rest.slice(0, Math.max(0, rest.length - 3))) {
      await p.close().catch(() => {});
      n++;
    }
    return n ? `chiuse ${n} schede di sfondo (vuote, doppie, pubblicita' o oltre le 3 piu' recenti)` : '';
  }

  hook(p) {
    if (this.hooked.has(p)) return;
    this.hooked.add(p);
    // renderer morto (memoria, crash): ogni evaluate resterebbe appeso, la scheda va riaperta
    p.on('crash', () => this.crashed.add(p));
    const net = new Map();
    this.net.set(p, net);
    const SKIP = /^(websocket|eventsource|ping|media|manifest|other)$/;
    const TRACK = /google-analytics|googletagmanager|doubleclick|matomo|piwik|hotjar|clarity\.ms|facebook\.net|connect\.facebook|analytics|\/collect\?|newrelic|nr-data|sentry|bugsnag|datadog|cookiebot|iubenda|onetrust|recaptcha|gstatic/i;
    p.on('request', (r) => {
      if (!SKIP.test(r.resourceType()) && !TRACK.test(r.url())) net.set(r, Date.now());
    });
    p.on('requestfinished', (r) => net.delete(r));
    p.on('requestfailed', (r) => net.delete(r));
    p.on('framenavigated', (f) => {
      if (f === p.mainFrame()) {
        net.clear();
        this.navAt.set(p, Date.now());
      }
    });
    p.on('dialog', async (d) => {
      const type = d.type();
      const msg = d.message().replace(/\s+/g, ' ').slice(0, 200);
      const accept = type === 'alert' || type === 'beforeunload' || this.dialogAccept;
      this.dialogAccept = false;
      try {
        if (accept) await d.accept();
        else await d.dismiss();
      } catch {}
      this.events.push(
        `finestra ${type} "${msg}" -> ${accept ? 'accettata' : 'annullata'}` +
          (!accept ? ' (per accettarla: passo {"dialog":"accept","confirm":true} poi ripeti l\'azione)' : '')
      );
    });
    p.on('download', (dl) => {
      const job = (async () => {
        const raw = dl.suggestedFilename() || 'download';
        const name = raw.replace(/[\\/:*?"<>|]/g, '_');
        fs.mkdirSync(this.cfg.downloadsDir, { recursive: true });
        const ext = path.extname(name);
        let target = path.join(this.cfg.downloadsDir, name);
        for (let i = 1; fs.existsSync(target); i++) target = path.join(this.cfg.downloadsDir, `${path.basename(name, ext)} (${i})${ext}`);
        await dl.saveAs(target);
        let extra = '';
        if (/\.pdf$/i.test(target)) {
          try {
            const r = pdfText(target);
            this.lastPdf = { file: target, ...r };
            if (r.text) extra = ` (PDF, ${r.pages} pag., ${r.text.length} caratteri: browse_read mode "pdf")`;
          } catch {}
        }
        this.events.push(`download salvato: ${target}${extra}`);
      })().catch((e) => this.events.push('download fallito: ' + firstLine(e)));
      this.pending.add(job);
      job.finally(() => this.pending.delete(job));
    });
  }

  framePrefix(f) {
    if (f === f.page().mainFrame()) return '';
    let id = this.frameIds.get(f);
    if (!id) {
      id = 'f' + ++this.frameN;
      this.frameIds.set(f, id);
    }
    return id;
  }

  allowedUrl(u) {
    if (!this.cfg.allowed.length) return true;
    try {
      const h = new URL(u).hostname.toLowerCase();
      return this.cfg.allowed.some((d) => h === d || h.endsWith('.' + d));
    } catch {
      return false;
    }
  }

  // ---------- lettura pagina ----------
  async collect(o = {}) {
    const page = await this.ensure();
    const main = page.mainFrame();
    const out = { items: [], regions: [], alerts: [], modal: '', captcha: false, login: false, total: 0, meta: null, ngroups: 0 };
    for (const f of page.frames()) {
      if (f.isDetached()) continue;
      const isMain = f === main;
      if (!isMain) {
        let box = null;
        try {
          const fe = await f.frameElement();
          box = await fe.boundingBox();
          await fe.dispose();
        } catch {}
        if (!box || box.width < 20 || box.height < 20) continue;
        if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha|captcha-delivery|geetest/i.test(f.url())) {
          if (box.height >= 40 && !/\/anchor\?.*size=invisible/.test(f.url())) out.captcha = true;
          continue;
        }
      }
      let r;
      for (let attempt = 0; attempt < 2 && !r; attempt++) {
        try {
          const arg = { prefix: this.framePrefix(f), start: this.idN, json: true, areas: !!o.areas };
          r = JSON.parse(isMain ? await evalIn(f, P.collectInPage, arg, 15000) : await evalIn(f, P.collectInPage, arg, 4000));
        } catch (e) {
          if (!isMain) break;
          if (attempt) throw e;
          await this.settle(page, 2000, 150);
        }
      }
      if (!r) continue;
      if (r.n > this.idN) this.idN = r.n;
      const off = out.regions.length;
      const goff = out.ngroups;
      out.ngroups += r.ngroups || 0;
      for (const it of r.items) {
        if (it.reg >= 0) it.reg += off;
        if (it.grp >= 0) it.grp += goff;
        it.frame = f;
        out.items.push(it);
      }
      out.regions.push(...r.regions);
      for (const a of r.alerts) if (!out.alerts.includes(a)) out.alerts.push(a);
      if (isMain) {
        out.meta = r.meta;
        out.mut = r.mut;
        out.url = page.url();
        out.nframes = page.frames().length;
      }
      if (r.modal && !out.modal) out.modal = r.modal;
      out.captcha ||= r.captcha;
      out.login ||= r.login;
      out.total += r.total;
    }
    if (out.modal) out.items = out.items.filter((i) => i.frame === main);
    // nome e ruolo di ogni ref visto: se il ref scade (elemento ricreato) si ritrova lo stesso controllo per nome
    if (this.refInfo.size > 6000) this.refInfo.clear();
    for (const i of out.items) if (i.name) this.refInfo.set(i.id, { name: i.name, role: i.role, ctx: i.ctx });
    out.alerts = out.alerts.slice(0, 6);
    const ch = await this.challenge(page);
    if (ch && !ch.err) {
      out.captcha = true;
      out.challenge = ch;
    }
    if (out.meta) {
      this.stats.vw = out.meta.vw || this.stats.vw;
      this.stats.vh = out.meta.vh || this.stats.vh;
    }
    return out;
  }

  /** Rilegge la pagina solo se e' cambiata (mutazioni DOM, URL, frame, scheda). */
  async freshSnap(snap, page) {
    if (snap && snap.mut && snap.url === page.url() && snap.nframes === page.frames().length && this.last && this.last.page === page) {
      try {
        const m = await page.mainFrame().evaluate(() => window.__cbMut || 0);
        if (m === snap.mut) return snap;
      } catch {}
    }
    return this.collect();
  }

  tabs() {
    return this.ctx ? this.ctx.pages().filter((p) => !p.isClosed()).length : 1;
  }

  remember(snap) {
    this.last = { page: this.page, url: this.page.url(), modal: snap.modal, prev: snapKeys(snap) };
  }

  /**
   * Attende che la pagina sia stabile: documento caricato, DOM fermo da quietMs,
   * nessuna richiesta di rete in corso (escluse quelle aperte da >4 s), almeno minMs
   * trascorsi (per intercettare navigazioni ritardate dopo un clic), massimo maxMs.
   */
  async settle(page, maxMs = 2500, quietMs = 150, minMs = 0) {
    const t0 = Date.now();
    const net = this.net.get(page);
    let navWaits = 0;
    while (Date.now() - t0 < maxMs) {
      let st;
      try {
        st = await evalIn(page.mainFrame(), (spin) => {
          let s = 0;
          // indicatori di caricamento visibili (SPA che caricano i risultati dopo la risposta di rete)
          if (spin)
            for (const e of document.querySelectorAll('[aria-busy=true],[role=progressbar]:not([aria-valuenow]),.spinner,.loading,.loader,[class*="spinner" i],[class*="loading-indicator" i],[class*="skeleton" i]')) {
              const r = e.getBoundingClientRect();
              if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > innerHeight) continue;
              const cs = getComputedStyle(e);
              if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.1) continue;
              s = 1;
              break;
            }
          return { m: window.__cbMut ? performance.now() - window.__cbMut : 1e9, r: document.readyState, s };
        }, maxMs >= 4000, 3000);
      } catch (e) {
        if (page.isClosed() || navWaits++ > 3) return;
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: Math.max(1000, Math.min(maxMs, 15000) - (Date.now() - t0)) });
        } catch {}
        continue;
      }
      const now = Date.now();
      let busy = 0;
      if (net) for (const t of net.values()) if (now - t < 8000) busy++;
      // uno spinner sempre visibile (decorativo) non deve bloccare oltre 6 s
      const spinning = st.s && now - t0 < 6000;
      // pagine che si ricaricano da sole subito dopo il caricamento (controlli anti-bot, redirect JS): si aspetta il documento nuovo
      const justNav = now - (this.navAt.get(page) || 0) < 350;
      if (now - t0 >= minMs && st.r !== 'loading' && st.m >= quietMs && busy === 0 && !spinning && !justNav) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return false;
  }

  async dismissCookies(page) {
    if (!this.cfg.rejectCookies) return '';
    for (const f of page.frames()) {
      try {
        const r = await evalIn(f, P.dismissCookiesInPage);
        if (r) {
          await this.settle(page, 1500, 150);
          return r;
        }
      } catch {}
    }
    return '';
  }

  /** Popup promozionali che coprono la pagina appena aperta: chiusi con il loro pulsante (CB_CLOSE_POPUPS). */
  async dismissPopup(page) {
    if (!this.cfg.closePopups) return '';
    const closed = [];
    for (let k = 0; k < 2; k++) {
      const r = await evalIn(page.mainFrame(), P.dismissPopupInPage, null, 2500).catch(() => '');
      if (!r) break;
      closed.push(r);
      await this.settle(page, 1500, 150);
    }
    return closed.length ? `chiuso popup ${closed.map((x) => '"' + x + '"').join(', ')}` : '';
  }

  // ---------- modelli URL per sito: i filtri impostati a mano diventano un URL riusabile ----------
  filtersFile() {
    return path.join(path.dirname(this.cfg.profileDir), 'site-filters.json');
  }

  loadFilters() {
    try {
      return JSON.parse(fs.readFileSync(this.filtersFile(), 'utf8'));
    } catch {
      return {};
    }
  }

  rememberFilters(from, to) {
    if (!this.trail || !this.trail.length) return '';
    let a, b;
    try {
      a = new URL(from);
      b = new URL(to);
    } catch {
      return '';
    }
    b.hash = '';
    // filtri e ordinamenti cambiano solo i parametri dello stesso elenco; una pagina di dettaglio non e' un modello
    if (a.host !== b.host || a.pathname !== b.pathname || !b.search || a.href.replace(/#.*$/, '') === b.href) return '';
    // mai salvare URL con credenziali, codici monouso o risposte di verifica
    const risky = (k) => /^(.*[_-])?(token|session|sessionid|sid|auth|key|apikey|code|password|pass|email|otp|signature|sig|nonce|state)$/i.test(k) || /captcha|response/i.test(k);
    if ([...b.searchParams.keys()].some(risky)) return '';
    const host = b.host;
    const m = this.loadFilters();
    const via = this.trail.join(' › ').slice(0, 100);
    m[host] = [{ url: b.href, via }, ...(m[host] || []).filter((x) => x.url !== b.href)].slice(0, 5);
    try {
      fs.mkdirSync(path.dirname(this.filtersFile()), { recursive: true });
      fs.writeFileSync(this.filtersFile(), JSON.stringify(m, null, 1));
    } catch {
      return '';
    }
    return `URL salvato come modello per ${host}`;
  }

  savedFilters(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return '';
    }
    // solo sulle pagine senza parametri: chi apre gia' un URL con i filtri non ne ha bisogno
    if (u.search) return '';
    const list = (this.loadFilters()[u.host] || []).slice(0, 3);
    return list.length ? `modelli URL gia' usati qui (cambia i parametri e apri):\n` + list.map((x) => `${x.url} (${x.via})`).join('\n') : '';
  }

  // ---------- tool: open ----------
  async open(url, { rows, filter, search } = {}) {
    let page = await this.ensure();
    const u = this.checkUrl(url, { strip: true });
    let resp = null;
    try {
      ({ page, resp } = await this.nav(page, u));
    } catch (e) {
      // link a un file (PDF, CSV...): Chrome lo scarica invece di aprirlo
      if (!/download is starting/i.test(String(e && e.message))) throw e;
      await new Promise((r) => setTimeout(r, 300));
      if (this.pending.size) await Promise.race([Promise.all([...this.pending]), new Promise((r) => setTimeout(r, 30000))]);
      return ['il link scarica un file', ...this.events.splice(0)].join('\n');
    }
    await this.settle(page, 8000, 250, 300);
    const g = await this.humanGate(page);
    page = g.page;
    const ck = await this.dismissCookies(page);
    const pop = g.stuck ? '' : await this.dismissPopup(page);
    let sr = null;
    if (search && !g.stuck) {
      sr = await this.siteSearch(page, String(search));
      page = this.page;
    }
    let snap = await this.collect();
    // pagina ancora vuota (contenuto disegnato tardi, pagina che si ricarica da sola): un'altra breve attesa
    if (!snap.total && !g.stuck) {
      await this.settle(page, 5000, 300, 600);
      snap = await this.collect();
    }
    this.remember(snap);
    this.stats.observations++;
    let txt = renderView(snap, { url: page.url(), tabs: this.tabs(), max: this.cfg.maxItems, rows, filter });
    if (filter && rows !== false) txt += await this.filterText(page, snap, filter);
    if (sr) txt = (sr.err || sr.note) + '\n' + txt;
    const status = !sr && resp ? resp.status() : 0;
    if (status >= 400) txt = this.badStatus(status, page.url(), snap) + '\n' + txt;
    if (ck) txt = `cookie: rifiutati i non necessari (${ck})\n` + txt;
    if (pop) txt = pop + '\n' + txt;
    if (g.note) txt = g.note + '\n' + txt;
    const ev = this.events.splice(0);
    if (ev.length) txt = ev.join('\n') + '\n' + txt;
    const pdf = await page.evaluate(() => document.contentType === 'application/pdf').catch(() => false);
    if (pdf) txt = 'documento PDF: testo con browse_read mode "pdf"\n' + txt;
    if (!this.allowedUrl(page.url())) txt = `ATTENZIONE: ${new URL(page.url()).hostname} e' fuori dai domini consentiti, le azioni sono bloccate\n` + txt;
    const tpl = status >= 400 || sr ? '' : this.savedFilters(page.url());
    if (tpl) txt += '\n' + tpl;
    return txt;
  }

  /** Cerca con il campo di ricerca del sito: l'URL dei risultati e' sempre valido (niente indirizzi indovinati). */
  async siteSearch(page, q) {
    const SEL = [
      'input[type=search]', 'input[role=searchbox]', 'input[role=combobox]', 'input[name=q]', 'input[name=query]', 'input[name=search]', 'input[name*=search i]', 'input[name*=keyword i]', 'input[name=libera]', 'input[name=k]', 'input[name=s]',
      'input[placeholder*=cerc i]', 'input[placeholder*=search i]', 'input[placeholder*=such i]', 'input[placeholder*=recherch i]', 'input[placeholder*=busc i]',
      'input[aria-label*=cerc i]', 'input[aria-label*=search i]', 'input[aria-label*=such i]', 'input[aria-label*=recherch i]',
    ].join(',');
    const visible = async () => {
      const l = page.locator(SEL);
      const n = Math.min(await l.count().catch(() => 0), 12);
      for (let i = 0; i < n; i++) {
        const x = l.nth(i);
        if ((await x.isVisible().catch(() => false)) && (await x.isEditable().catch(() => false))) return x;
      }
      return null;
    };
    let box = await visible();
    if (!box) {
      // campo nascosto dietro l'icona della lente
      const btn = page.locator('button[aria-label*=cerc i],button[aria-label*=search i],a[aria-label*=cerc i],a[aria-label*=search i],[role=button][aria-label*=search i],[role=button][aria-label*=cerc i],button[title*=cerc i],button[title*=search i]').first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        await this.settle(page, 1500, 150);
        box = await visible();
      }
    }
    if (!box) return { err: 'nessun campo di ricerca sul sito: usa browse_search con site' };
    const before = page.url();
    await box.fill(q, { timeout: 5000 });
    await box.press('Enter', { timeout: 5000 });
    await page.waitForURL((x) => String(x) !== before, { timeout: 8000, waitUntil: 'commit' }).catch(() => {});
    await this.settle(page, 8000, 300, 500);
    const after = page.url();
    if (after === before) return { note: `cercato "${q}" con il campo del sito (stesso URL: risultati nella pagina)` };
    const saved = this.rememberSearch(after, q);
    return { note: `cercato "${q}" con il campo del sito${saved ? '; ' + saved : ''}` };
  }

  /** URL dei risultati con {q} al posto del testo cercato: la prossima volta si apre direttamente. */
  rememberSearch(url, q) {
    let b;
    try {
      b = new URL(url);
    } catch {
      return '';
    }
    const fq = fold(q);
    const key = [...b.searchParams.keys()].find((k) => fold(b.searchParams.get(k)) === fq);
    if (!key) return '';
    if ([...b.searchParams.keys()].some((k) => /^(.*[_-])?(token|session|sessionid|sid|auth|apikey|password|otp|signature|sig|nonce)$/i.test(k))) return '';
    b.hash = '';
    b.searchParams.set(key, '{q}');
    const tpl = b.href.replace(/%7Bq%7D/i, '{q}');
    const m = this.loadFilters();
    m[b.host] = [{ url: tpl, via: 'ricerca del sito' }, ...(m[b.host] || []).filter((x) => x.url !== tpl)].slice(0, 5);
    try {
      fs.mkdirSync(path.dirname(this.filtersFile()), { recursive: true });
      fs.writeFileSync(this.filtersFile(), JSON.stringify(m, null, 1));
    } catch {
      return '';
    }
    return `modello di ricerca salvato: ${tpl}`;
  }

  /** Errore HTTP: si dice subito che l'URL non e' buono e come arrivare ai risultati veri. */
  badStatus(status, url, snap) {
    let host = '';
    let origin = '';
    try {
      ({ host, origin } = new URL(url));
    } catch {}
    const what =
      status === 404 || status === 410 ? 'pagina inesistente (URL indovinato o scaduto)' : status === 400 ? "richiesta non valida (parametri dell'URL sbagliati)" : status === 403 || status === 429 ? 'accesso rifiutato dal sito' : 'errore del sito';
    if (status >= 500 || status === 403 || status === 429) return `HTTP ${status}: ${what}`;
    const tpl = (this.loadFilters()[host] || []).find((x) => x.url.includes('{q}'));
    const box = snap.items.find((i) => /^(text|combo)$/.test(i.role) && /cerc|search|such|recherch|busc|cosa/i.test(i.name || ''));
    const how = tpl ? `modello di ricerca di ${host}: ${tpl.url}` : `cerca dal sito: browse_open {url:"${origin}", search:"testo"}${box ? ` o il campo ${box.id}` : ''}`;
    return `HTTP ${status}: ${what}. ${how}`;
  }

  // ---------- tool: search ----------
  // in una scheda propria: la pagina attiva resta com'e' e piu' ricerche possono girare insieme
  async search({ query, max = 8, site }) {
    const q = String(query || '').trim();
    if (!q) throw new Error('serve "query"');
    const dom = String(site || '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
    const full = dom ? `${q} site:${dom}` : q;
    const urls = [];
    let denied = null;
    for (const s of this.cfg.searchUrls) {
      try {
        urls.push(this.checkUrl((s.includes('{q}') ? s : s + '{q}').replace('{q}', encodeURIComponent(full))));
      } catch (e) {
        denied = denied || e;
      }
    }
    if (!urls.length) throw denied;
    let page = await this.bgPage();
    let keep = false;
    const n = Math.min(Math.max(1, max), 20);
    const notes = [];
    let rows = [];
    try {
      for (const [k, u] of urls.entries()) {
        ({ page } = await this.nav(page, u));
        await this.settle(page, 6000, 200, 200);
        const host = new URL(u).hostname.replace(/^(www|html)\./, '');
        const last = k === urls.length - 1;
        const ch = await this.challenge(page);
        if (ch && ch.block && !last) {
          // un altro motore costa meno di una verifica da far risolvere all'utente
          notes.push(`${host} chiede una verifica ${ch.kind}: uso il motore successivo`);
          continue;
        }
        if (last) {
          const g = await this.humanGate(page);
          page = g.page;
          if (g.note) notes.push(g.note);
          if (g.stuck) keep = true;
        }
        rows = await page.evaluate(P.searchResultsInPage, { max: n }).catch(() => []);
        if (rows.length || last) {
          if (k) notes.push(`risultati da ${host}`);
          break;
        }
        notes.push(`${host}: nessun risultato leggibile, uso il motore successivo`);
      }
      if (!rows.length) keep = true;
    } finally {
      if (keep && !page.isClosed()) {
        // niente risultati leggibili o verifica da completare: la pagina diventa quella attiva, da guardare con browse_view
        this.inUse.delete(page);
        this.bgDone();
        this.page = page;
        this.last = null;
        await within(page.bringToFront(), 3000).catch(() => {});
      } else await this.bgClose(page);
    }
    this.stats.observations++;
    const short = (s) => s.replace(/^https:\/\//, '');
    const head = (notes.length ? notes.join('; ') + '\n' : '') + `ricerca "${full}": ${rows.length} risultati`;
    if (!rows.length) return head + ' (pagina aperta: browse_view per vederla)';
    return head + '\n' + rows.map((r, i) => `${i + 1}. ${r.title} | ${short(r.url)}${r.snip ? ' | ' + r.snip : ''}`).join('\n');
  }

  checkUrl(url, { strip = false } = {}) {
    let u;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url);
    } catch {
      throw new Error('URL non valido: ' + url);
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error(`schema ${u.protocol} non consentito (solo http/https)`);
    if (!this.allowedUrl(u.href)) throw new Error(`${u.hostname} non e' tra i domini consentiti (${this.cfg.allowed.join(', ')})`);
    if (strip && this.cfg.stripTracking && u.search) {
      const gone = [];
      const keep = u.search
        .slice(1)
        .split('&')
        .filter((kv) => {
          let k = kv.split('=')[0];
          try {
            k = decodeURIComponent(k);
          } catch {}
          if (!TRACK_PARAM.test(k)) return true;
          if (!gone.includes(k)) gone.push(k);
          return false;
        });
      if (gone.length) {
        u.search = keep.length ? '?' + keep.join('&') : '';
        this.events.push(`tolti i parametri di tracciamento: ${gone.join(', ')}`);
      }
    }
    return u.href;
  }

  // ---------- tool: view ----------
  async view(opts = {}) {
    let page = await this.ensure();
    const g = await this.humanGate(page);
    page = g.page;
    const areas = opts.scope === 'areas';
    let snap = await this.collect({ areas });
    // popup promozionale comparso dopo l'apertura (newsletter dopo qualche secondo): chiuso, poi si rilegge
    let pop = '';
    if (snap.modal && !areas) {
      pop = await this.dismissPopup(page);
      if (pop) snap = await this.collect({ areas });
    }
    this.stats.observations++;
    if (areas) {
      const list = snap.items.filter((i) => i.role === 'area' || i.hid);
      this.remember(snap);
      const head = `aree cliccabili senza nome: ${list.length} (nome ~file = immagine, LxA @x,y = centro 0-1)`;
      return [g.note, head, ...list.map((i) => lineOf(i, true)), list.length ? 'usa il ref con click/hover/upload' : 'nessuna: prova browse_screenshot'].filter(Boolean).join('\n');
    }
    if (!opts.filter && !opts.offset) this.remember(snap);
    let txt = renderView(snap, { url: page.url(), tabs: this.tabs(), max: this.cfg.maxItems, ...opts });
    if (opts.filter) txt += await this.filterText(page, snap, opts.filter);
    if (pop) txt = pop + '\n' + txt;
    return g.note ? g.note + '\n' + txt : txt;
  }

  /** Il filtro non trova elementi interattivi: le stesse parole nel testo della pagina (celle di tabella, etichette). */
  async filterText(page, snap, filter) {
    const alts = filterAlts(filter);
    if (!alts.length || snap.items.some((i) => matchesFilter(`${i.name} ${i.role} ${i.value || ''} ${i.ctx || ''}`, alts))) return '';
    const hits = [];
    for (const f of page.frames()) {
      try {
        const r = await evalIn(f, P.findTextInPage, { query: alts.join('|'), max: 15 }, 4000);
        hits.push(...r.hits);
      } catch {}
      if (hits.length >= 15) break;
    }
    return hits.length ? `\ntesto della pagina con "${filter}" (non interattivo):\n` + hits.slice(0, 15).join('\n') : '';
  }

  // ---------- CAPTCHA e verifiche anti-bot ----------
  /** Verifica in corso nella pagina: null se nessuna, { err } se la pagina non e' leggibile (es. in navigazione). */
  async challenge(page) {
    let ch;
    try {
      ch = await page.mainFrame().evaluate(P.challengeInPage);
    } catch {
      return { err: true };
    }
    // Cloudflare gia' superato (cookie cf_clearance) e pagina con contenuto vero: resti dello script, non un muro
    if (ch && ch.block && /Cloudflare|anti-bot|Turnstile/.test(ch.kind)) {
      try {
        const cks = await page.context().cookies(page.url());
        if (cks.some((c) => c.name === 'cf_clearance')) {
          const rich = await page.mainFrame().evaluate(() => {
            const t = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').length;
            return t > 1500 && document.links.length > 10;
          });
          if (rich) return null;
        }
      } catch {}
    }
    return ch;
  }

  /**
   * Se la pagina e' bloccata da una verifica (o, con el, se il modulo di el contiene un CAPTCHA non risolto)
   * Colibri non la aggira: si mette in pausa, mostra una barra all'utente e riprende da solo quando la verifica
   * e' superata. Senza finestra (headless) riapre Chrome visibile sulla stessa pagina.
   * Ritorna { page, note, stuck }.
   */
  async humanGate(page, el = undefined) {
    const inline = el !== undefined;
    let ch = await this.challenge(page);
    if (!ch || ch.err) return { page, note: '' };
    if (ch.hard) {
      if (inline) return { page, note: '' };
      // un blocco non si supera aspettando: si dice subito cosa fare
      const how =
        this.cfg.mode === 'launch'
          ? "riprova in modalita' Chrome reale (CB_MODE=cdp: il tuo Chrome normale, non segnato come automatizzato)"
          : 'il blocco riguarda la connessione o il profilo: usa un\'altra fonte (browse_search) o riprova piu\' tardi';
      return { page, stuck: true, note: `il sito ${hostOf(page.url())} ha bloccato il browser (non e' una verifica da risolvere): ${how}` };
    }
    if (inline) {
      if (ch.block || ch.solved) return { page, note: '' };
      const inForm = await (el ? el.evaluate(P.captchaFormInPage) : page.mainFrame().evaluate(P.captchaFormInPage, null)).catch(() => false);
      if (!inForm) return { page, note: '' };
    } else if (!ch.block) return { page, note: '' };
    const sec = this.cfg.humanWait;
    // Chrome avviato da Playwright e' segnalato come automatizzato: alcuni siti ripropongono la verifica all'infinito
    const hint =
      !inline && this.cfg.mode === 'launch'
        ? '. Se la verifica si ripete in loop il sito blocca il Chrome automatizzato: usa la modalita\' Chrome reale (CB_MODE=cdp; Colibri avvia il tuo Chrome normale e non lo chiude)'
        : '';
    const ask0 = `chiedi all'utente di completarla nella finestra di Chrome, poi browse_view`;
    const ask = ask0 + hint;
    if (!sec) return { page, stuck: true, note: `verifica ${ch.kind} in corso: ${ask}` };
    const t0 = Date.now();
    const pre = [];
    const done = (c) => !c || (!c.err && (inline ? !c.block && c.solved : !c.block));
    const poll = async (until, banner) => {
      // l'attesa dell'utente non conta nel tempo massimo della chiamata (vedi index.js)
      this.humanActive = (this.humanActive || 0) + 1;
      try {
        return await pollInner(until, banner);
      } finally {
        this.humanActive--;
      }
    };
    const pollInner = async (until, banner) => {
      let c = ch;
      if (banner) await page.bringToFront().catch(() => {});
      while (!done(c) && Date.now() < until) {
        if (page.isClosed()) {
          if (!this.ctx) return { err: true, closed: true };
          page = await this.ensure();
        }
        if (banner) await page.mainFrame().evaluate(P.humanBannerInPage, { show: true, kind: ch.kind }).catch(() => {});
        await new Promise((r) => setTimeout(r, 700));
        c = await this.challenge(page);
        if (c && !c.err && c.kind) ch = c;
      }
      if (banner) await page.mainFrame().evaluate(P.humanBannerInPage, { show: false }).catch(() => {});
      return c;
    };
    let c;
    if (this.cfg.headless) {
      // molte verifiche (Cloudflare "Just a moment", Turnstile gestito) si superano da sole in pochi secondi
      c = await poll(t0 + Math.min(8, sec) * 1000, false);
      if (!done(c)) {
        if (inline || this.cfg.mode !== 'launch' || !this.cfg.humanShow)
          return { page, stuck: true, note: `verifica ${ch.kind} in corso ma il browser e' senza finestra (CB_HEADLESS): ${inline ? 'serve una finestra visibile' : ask}` };
        const url = page.url();
        await this.close();
        this.cfg.headless = false;
        page = await this.ensure();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await this.settle(page, 8000, 250, 300);
        pre.push('aperta una finestra visibile di Chrome per la verifica');
        ch = (await this.challenge(page)) || ch;
        c = await poll(t0 + sec * 1000, true);
      }
    } else c = await poll(t0 + sec * 1000, true);
    const s = Math.round((Date.now() - t0) / 1000);
    if (c && c.closed) return { page, stuck: true, note: 'finestra chiusa durante la verifica' };
    if (!done(c)) return { page, stuck: true, note: [...pre, `verifica ${ch.kind} ancora da completare dopo ${s} s: ${ask0} (riprende ad aspettare)${hint}`].join('; ') };
    await this.settle(page, 8000, 250, 200);
    return { page, note: [...pre, `verifica ${ch.kind} superata dopo ${s} s`].join('; ') };
  }

  // ---------- tool: do ----------
  resolve(snap, target) {
    if (typeof target === 'string' && /^(f\d+)?e\d+$/.test(target.trim())) {
      const id = target.trim();
      const it = snap.items.find((i) => i.id === id);
      if (it) return { it };
      // ref scaduto: la pagina ha ricreato l'elemento (finestra aperta, lista ridisegnata); stesso nome e ruolo
      const old = this.refInfo.get(id);
      if (old) {
        let same = snap.items.filter((i) => i.role === old.role && i.name === old.name);
        if (!same.length) same = snap.items.filter((i) => i.role === old.role && fold(i.name) === fold(old.name));
        if (same.length > 1 && old.ctx) same = same.filter((i) => i.ctx === old.ctx);
        if (same.length === 1) return { it: same[0], note: `${id} scaduto → ${same[0].id} "${same[0].name}"` };
      }
      return { err: `${target} non trovato: ref scaduto (pagina cambiata) o elemento non visibile ora` };
    }
    const qy = typeof target === 'string' ? { name: target } : target || {};
    if (!qy.name) return { err: 'target mancante: usa un ref (es. "e12") o un testo' };
    // confronto senza accenti, asterischi e punteggiatura
    const n = fold(qy.name);
    const row = qy.row ? fold(qy.row) : '';
    const cands = snap.items.filter((i) => (!qy.role || i.role === qy.role) && (!row || fold(i.ctx).includes(row)));
    const isLow = (i) => !!(snap.regions[i.reg] && snap.regions[i.reg].low);
    // priorita': esatto nel contenuto principale, esatto ovunque, parziale nel principale, parziale ovunque
    const exact = cands.filter((i) => fold(i.name) === n);
    const part = cands.filter((i) => fold(i.name).includes(n));
    let m = [];
    for (const tier of [exact.filter((i) => !isLow(i)), exact, part.filter((i) => !isLow(i)), part]) {
      if (tier.length) {
        m = tier;
        break;
      }
    }
    if (m.length > 1 && qy.n) m = [m[qy.n - 1]].filter(Boolean);
    if (!m.length && cands.length) {
      // ultima possibilita': somiglianza (refusi, sinonimi, altre lingue) con confidenza, come una domanda "choice"
      const r = choice(cands.map((i) => ({ key: i.id, logit: 7 * similarity(qy.name, i.name) - (isLow(i) ? 0.8 : 0), data: i })));
      if (decide(r, PRESETS.balanced) === 'act') return { it: r.data, note: `"${qy.name}" → ${r.data.id} "${r.data.name}" per somiglianza (${Math.round(r.confidence * 100)}%)` };
      const alt = r.probs.filter((x) => x.key).slice(0, 3).map((x) => `${x.key} "${x.data.name}" ${Math.round(x.p * 100)}%`).join(' · ');
      return { err: `nessun elemento "${qy.name}"${row ? ' nella riga "' + qy.row + '"' : ''}; piu' simili: ${alt}` };
    }
    if (!m.length) return { err: `nessun elemento "${qy.name}"${qy.role ? ' con ruolo ' + qy.role : ''}${row ? ' nella riga "' + qy.row + '"' : ''}` };
    if (m.length > 1) return { err: `"${qy.name}" ambiguo (${m.length}): ${m.slice(0, 5).map((i) => lineOf(i, true)).join(' | ')}` };
    return { it: m[0] };
  }

  async handle(it) {
    const h = await it.frame.evaluateHandle((id) => (window.__cb && window.__cb.byId.get(id)) || null, it.id);
    const el = h.asElement();
    if (!el) {
      await h.dispose();
      return null;
    }
    return el;
  }

  // elenco schede senza toccare le pagine: risponde anche se una scheda e' bloccata
  async tabList() {
    if (!this.ctx) await this.ensure();
    const cur = this.page;
    const pages = this.ctx.pages().filter((p) => !p.isClosed() && !this.inUse.has(p));
    const url = (p) => {
      try {
        return p.url();
      } catch {
        return '?';
      }
    };
    return 'schede: ' + pages.map((p, k) => `${k + 1}${p === cur ? '*' : ''} ${url(p)}`).join(' | ');
  }

  async run(steps, { view = 'diff' } = {}) {
    if (steps.length && steps.every((s) => s && s.tab === 'list' && Object.keys(s).length === 1)) return `ok ${steps.length}/${steps.length} · ${await this.tabList()}`;
    let page = await this.ensure();
    const notes = [];
    let done = 0;
    let warns = 0;
    let t0s = 0;
    let stop = '';
    const g0 = await this.humanGate(page);
    page = g0.page;
    if (g0.note) notes.push(g0.note);
    if (g0.stuck) return `ok 0/${steps.length} · fermo: ${g0.note}`;
    let snap = await this.collect();
    if (!this.last || this.last.page !== page) this.remember(snap);
    const touched = new Map();
    const startUrl = page.url();
    await page.mainFrame().evaluate(() => { window.__cbAdded = []; }).catch(() => {});
    const startModal = this.last.modal;
    let readText = '';
    this.trail = [];

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i] || {};
      const act = ACTIONS.find((a) => st[a] !== undefined);
      const tag = `passo ${i + 1}`;
      if (!act) {
        stop = `${tag}: azione non riconosciuta (${Object.keys(st).join(',') || 'vuoto'})`;
        break;
      }
      if (!['goto', 'back', 'tab', 'wait', 'find', 'read'].includes(act) && page.url() !== 'about:blank' && !this.allowedUrl(page.url())) {
        stop = `${tag}: BLOCCATO, la pagina ${new URL(page.url()).hostname} e' fuori dai domini consentiti`;
        break;
      }
      try {
        const nx = steps[i + 1];
        this.nextAct = nx ? ACTIONS.find((a) => nx[a] !== undefined) || '' : '';
        t0s = Date.now();
        const r = await this.step(act, st, snap, page);
        if (r && r.block) {
          stop = `${tag}: BLOCCATO ${r.block}`;
          break;
        }
        if (r && r.note) notes.push(`${tag}: ${r.note}`);
        if (r && r.warn) warns++;
        if (r && r.note && (act === 'read' || act === 'find')) readText += '\n' + r.note;
        if (r && r.id && (act === 'fill' || act === 'check')) touched.set(r.id, act);
        if (act === 'select' && this.trail.length && st.option !== undefined) this.trail[this.trail.length - 1] += '=' + [].concat(st.option).join('/');
        if (act === 'pick') this.trail.push(String(st.pick).slice(0, 30));
        done++;
        this.stats.actions++;
      } catch (e) {
        stop = `${tag} (${act}): errore: ${firstLine(e)}`;
        if (BROKEN.test(String((e && e.message) || e))) {
          await this.recover().catch(() => {});
          stop += ' (scheda bloccata: riaperta sulla stessa pagina, ripeti il passo)';
        }
        break;
      }
      if (this.newPages.length) for (const n of await this.adoptNewPages(act, page, t0s)) notes.push(`${tag}: ${n}`);
      page = this.page;
      if (i < steps.length - 1) {
        if (/^(click|press|goto|back|tab|waitFor)$/.test(act)) {
          const g = await this.humanGate(page);
          page = g.page;
          if (g.note) notes.push(`${tag}: ${g.note}`);
          if (g.stuck) {
            stop = `fermo dopo il passo ${i + 1}: verifica da completare`;
            break;
          }
        }
        snap = await this.freshSnap(snap, page);
      }
    }

    this.nextAct = '';
    if (this.pending.size) await Promise.race([Promise.all([...this.pending]), new Promise((r) => setTimeout(r, 15000))]);

    page = this.page;
    if (!stop) {
      const g = await this.humanGate(page);
      page = g.page;
      if (g.note) notes.push(g.note);
    }
    const tidy = await this.tidyTabs().catch(() => '');
    if (tidy) notes.push(tidy);
    if (!stop) {
      const saved = this.rememberFilters(startUrl, page.url());
      if (saved) notes.push(saved);
    }
    const after = await this.collect();
    this.stats.observations++;
    const head = [`ok ${done}/${steps.length}` + (warns ? ` · ⚠ ${warns} ${warns > 1 ? 'valori non accettati' : 'valore non accettato'}` : '') + (stop ? ' · ' + stop : '')];
    head.push(...notes, ...this.events.splice(0));

    let body = '';
    if (view !== 'none') {
      const navigated = page.url() !== startUrl || !this.last || this.last.page !== page;
      const modalChanged = after.modal !== startModal;
      const cover = view === 'diff' ? readCover(readText) : null;
      if (view === 'diff' && !navigated && !modalChanged) {
        let fresh = [];
        try {
          fresh = await page.mainFrame().evaluate(P.addedTextInPage, 4);
        } catch {}
        const known = new Set([...after.alerts, ...after.items.map((i) => i.name)]);
        fresh = fresh.filter((t) => !known.has(t) && !after.alerts.some((a) => a.includes(t) || t.includes(a)) && !(cover && cover.has(t)));
        body = renderDiff(this.last.prev, after, { url: page.url(), tabs: this.tabs(), touched, fresh, skip: cover && cover.skip }) || '';
      }
      // l'esito e' gia' nella lettura finale: della pagina nuova bastano intestazione e conteggi
      if (!body && cover) body = (navigated ? 'pagina cambiata\n' : '') + renderView(after, { url: page.url(), tabs: this.tabs(), rows: false });
      if (!body) body = (navigated ? 'pagina cambiata\n' : '') + renderView(after, { url: page.url(), tabs: this.tabs(), max: this.cfg.maxItems });
    }
    this.remember(after);
    return head.join('\n') + (body ? '\n---\n' + body : '');
  }

  needConfirm(it, act, st) {
    if (!this.cfg.confirmSensitive || st.confirm === true) return '';
    if ((act === 'click' || act === 'check') && it && it.s === 'c') return `!c ${it.id} "${it.name}": chiedi conferma all'utente, poi ripeti solo questo passo con "confirm": true`;
    return '';
  }

  async step(act, st, snap, page) {
    const noteOut = [];
    const target = async (t) => {
      let r = this.resolve(snap, t);
      let el = !r.err && (await this.handle(r.it));
      // ref non trovato o elemento sparito nel frattempo: si rilegge la pagina e si riprova (anche per nome)
      if (r.err || !el) {
        snap = await this.collect();
        const r2 = this.resolve(snap, t);
        if (!r2.err) {
          r = r2;
          el = await this.handle(r.it);
        }
      }
      if (r.err) throw new Error(r.err);
      if (r.note) noteOut.push(r.note);
      if (this.trail && r.it.name) this.trail.push(r.it.name.slice(0, 30));
      if (!el) throw new Error(`${r.it.id} non piu' presente: ref scaduto`);
      return { it: r.it, el };
    };
    const after = async (ms = 1500, min = 0) => this.settle(page, ms, 120, min);
    const res = await this.stepInner(act, st, snap, page, target, after);
    if (noteOut.length) return { ...(res || {}), note: [...noteOut, res && res.note].filter(Boolean).join('; ') };
    return res;
  }

  /** Target a coordinate relative (0..1, come la domanda "box" di Jev): test di colpo e controlli di sicurezza. */
  async pointTarget(t, snap, page, st) {
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const x = Math.round(Math.min(1, Math.max(0, t.x)) * (vp.w - 1));
    const y = Math.round(Math.min(1, Math.max(0, t.y)) * (vp.h - 1));
    const hit = await page.mainFrame().evaluate(P.hitTestInPage, { x, y });
    const it = hit.id ? snap.items.find((i) => i.id === hit.id) : null;
    const what = it ? `${it.id} "${it.name}"` : `<${hit.tag}>${hit.text ? ' "' + hit.text + '"' : ''}`;
    const s = it ? it.s : hit.s;
    if (it && it.flags.includes('off')) throw new Error(`${what} e' disattivato`);
    if (s === 'x') return { block: `!x ${what}: campo riservato` };
    if (s === 'c' && this.cfg.confirmSensitive && st.confirm !== true) return { block: `!c clic a (${t.x}, ${t.y}) su ${what}: chiedi conferma all'utente, poi ripeti con "confirm": true` };
    return { x, y, what };
  }

  async stepInner(act, st, snap, page, target, after) {
    const pt = (t) => t && typeof t === 'object' && typeof t.x === 'number' && typeof t.y === 'number';
    if ((act === 'click' || act === 'hover') && pt(st[act])) {
      const r = await this.pointTarget(st[act], snap, page, st);
      if (r.block) return r;
      if (act === 'click') await page.mouse.click(r.x, r.y);
      else await page.mouse.move(r.x, r.y);
      if (!(await after(act === 'click' ? 10000 : 800, act === 'click' ? 300 : 0))) return { note: 'pagina ancora in caricamento dopo 10 s' };
      return { note: `${act === 'click' ? 'clic' : 'puntatore'} a (${st[act].x}, ${st[act].y}) su ${r.what}` };
    }

    switch (act) {
      case 'click': {
        const { it, el } = await target(st.click);
        const why = this.needConfirm(it, 'click', st);
        if (why) return { block: why };
        if (it.flags.includes('off')) throw new Error(`${it.id} "${it.name}" e' disattivato`);
        const g = await this.humanGate(page, el);
        if (g.stuck) return { block: g.note };
        if (st.force) await el.evaluate((e) => e.click());
        else {
          const sig = () => page.evaluate(() => location.href + '|' + document.querySelectorAll('*').length + '|' + (document.body ? document.body.innerText.length : 0)).catch(() => '');
          const before = await sig();
          try {
            await el.click({ timeout: 5000 });
          } catch (e) {
            const coverOf = () =>
              el
                .evaluate((x) => {
                  const r = x.getBoundingClientRect();
                  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                  if (!top || top === x || x.contains(top) || top.contains(x)) return r.width && r.height ? '' : 'invisibile';
                  let d = top.closest('dialog,[role=dialog],[role=alertdialog],[aria-modal=true],[class*=modal i],[class*=popup i],[class*=overlay i],[class*=backdrop i]');
                  // velo senza classi riconoscibili: antenato fisso che copre buona parte della finestra
                  if (!d)
                    for (let a = top, k = 0; a && a !== document.body && k < 8; a = a.parentElement, k++) {
                      const s = getComputedStyle(a);
                      const q = a.getBoundingClientRect();
                      if ((s.position === 'fixed' || s.position === 'absolute') && q.width * q.height > 0.25 * innerWidth * innerHeight) {
                        d = a;
                        break;
                      }
                    }
                  const lab = (n) => (n.getAttribute('aria-label') || (n.querySelector('h1,h2,h3,[class*=title i]') || {}).innerText || n.id || n.className || n.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 50);
                  return d ? 'modale "' + lab(d) + '"' : '<' + top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + '>';
                })
                .catch(() => '');
            const m = String(e && e.message).match(/(<[^>\n]{1,90}>)[^\n]*intercepts pointer events/);
            if (m) {
              const cv = await coverOf();
              throw new Error(`${it.id} coperto da ${cv && cv !== 'invisibile' ? cv : m[1]}: chiudilo (Chiudi/×/Esc) oppure ripeti con "force": true`);
            }
            if (!/timeout|exceeded/i.test(String(e && e.message))) throw e;
            // il clic puo' essere arrivato (pagina lenta a rispondere): se la pagina e' cambiata e' riuscito
            await after(4000, 300);
            const now = await sig();
            if (now && before && now !== before) {
              if (!(await after(10000, 300))) return { note: `${it.id} clic in ritardo: pagina cambiata, ancora in caricamento` };
              return { note: [g.note, `${it.id} clic lento ma riuscito (la pagina e' cambiata)`].filter(Boolean).join('; ') };
            }
            const cover = await coverOf();
            if (cover === 'invisibile') throw new Error(`${it.id} "${it.name}" non e' visibile ora (dimensione zero): apri prima la sezione che lo contiene`);
            if (cover) throw new Error(`${it.id} coperto da ${cover}: chiudilo (Chiudi/×/Esc) oppure ripeti con "force": true`);
            throw new Error(`${it.id} "${it.name}" non risponde al clic entro 5 s e la pagina non e' cambiata: ripeti con "force": true o usa browse_view`);
          }
        }
        if (!(await after(10000, 300))) return { note: [g.note, 'pagina ancora in caricamento dopo 10 s (usa waitFor o browse_view)'].filter(Boolean).join('; ') };
        return g.note ? { note: g.note } : undefined;
      }
      case 'fill':
      case 'type': {
        const { it, el } = await target(st[act]);
        if (it.s === 'x') return { block: `!x ${it.id} "${it.name}": campo riservato (password, carta, OTP, IBAN), lo compila l'utente nella finestra del browser` };
        if (it.role === 'sel') throw new Error(`${it.id} e' un menu: usa "select"`);
        if (/^(chk|rad|sw)$/.test(it.role)) throw new Error(`${it.id} e' una casella: usa "check"`);
        const text = String(st.text ?? '');
        const ev0 = this.events.length;
        let viaScript = false;
        if (act === 'fill') {
          try {
            if (it.flags.includes('ro')) throw new Error('readonly');
            await el.fill(text, { timeout: 5000 });
          } catch (e) {
            if (it.role === 'date') throw new Error(`data non accettata: per i campi data nativi usa il formato AAAA-MM-GG (${firstLine(e)})`);
            if (!/readonly|not editable|editable/i.test(String(e && e.message))) throw e;
            // campi in sola lettura gestiti da widget (es. datepicker): valore impostato via script con eventi
            await el.evaluate((x, v) => {
              const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(x), 'value');
              if (set && set.set) set.set.call(x, v);
              else x.value = v;
              x.dispatchEvent(new Event('input', { bubbles: true }));
              x.dispatchEvent(new Event('change', { bubbles: true }));
              x.dispatchEvent(new Event('blur', { bubbles: true }));
            }, text);
            viaScript = true;
          }
        } else {
          await el.click({ timeout: 5000 });
          // campi che aprono una finestra (motori di ricerca voli, selettori di luogo): il focus passa a un altro campo
          // dopo un attimo e i tasti premuti subito andrebbero persi. Si attende che il cursore sia in un campo
          // modificabile (subito, per un campo normale) e si scrive li'.
          const frame = (await el.ownerFrame().catch(() => null)) || page.mainFrame();
          // firma di cio' che ha il cursore e delle finestre aperte: finche' cambia, il focus sta ancora spostandosi.
          // I campi normali sono stabili subito (nessun ritardo); un campo a finestra richiede 2-3 letture uguali.
          const sig = () =>
            frame
              .evaluate(() => {
                const a = document.activeElement;
                const ed = !!a && ((/^(input|textarea)$/i.test(a.tagName) && !a.readOnly && !a.disabled) || a.isContentEditable);
                const dlg = document.querySelectorAll('[role=dialog],dialog,[aria-modal=true]').length;
                return `${ed ? 1 : 0}|${a ? a.tagName + '#' + a.id + '|' + (a.getAttribute('aria-label') || a.name || '') : ''}|${dlg}`;
              })
              .catch(() => 'x');
          const popup = it.role === 'combo' || /^(menu|clk|area)$/.test(it.role);
          let last = '';
          let same = 0;
          for (let k = 0; k < 12; k++) {
            const s = await sig();
            same = s === last ? same + 1 : 0;
            last = s;
            if (s.startsWith('1') && (!popup || same >= 2)) break;
            await page.waitForTimeout(60);
          }
          await frame
            .evaluate(() => {
              const a = document.activeElement;
              if (a && typeof a.select === 'function') a.select();
            })
            .catch(() => {});
          await page.keyboard.type(text, { delay: 12 });
          // verifica: se il focus si e' spostato durante la digitazione manca qualche carattere; si riscrive tutto in un colpo
          const got = await frame.evaluate(() => (document.activeElement && 'value' in document.activeElement ? document.activeElement.value : null)).catch(() => null);
          if (got !== null && got !== text) {
            await frame.evaluate(() => document.activeElement && typeof document.activeElement.select === 'function' && document.activeElement.select()).catch(() => {});
            await page.keyboard.insertText(text);
          }
        }
        await after(act === 'type' ? 2500 : 1500);
        // il portale valida all'uscita dal campo (change/blur): si esce come farebbe l'utente, poi si rilegge
        if (act === 'fill' && it.role !== 'combo' && !viaScript && !/^(pick|press|type|hover|wait|waitFor)$/.test(this.nextAct || '')) {
          await el
            .evaluate((e) => {
              // campi con suggerimenti: uscire chiuderebbe l'elenco da scegliere
              if (e !== document.activeElement || e.getAttribute('aria-autocomplete') || e.getAttribute('list') || e.hasAttribute('aria-controls') || e.hasAttribute('aria-expanded') || e.type === 'search') return;
              e.blur();
            })
            .catch(() => {});
          await after(1200);
        }
        const v = await el.evaluate((e) => ('value' in e ? e.value : e.innerText || '')).catch(() => null);
        const box = this.events.slice(ev0).filter((x) => /^finestra (alert|confirm|prompt)/.test(x));
        const said = box.length ? ` · il sito ha risposto ${box.map((x) => x.replace(/^finestra \w+ /, '').replace(/ -> .*$/, '')).join(' ')}` : '';
        if (v !== null && act === 'fill' && v.trim() !== text.trim())
          return { id: it.id, warn: true, note: `⚠ ${it.id} "${it.name}" valore ora "${String(v).slice(0, 60)}" (richiesto "${text.slice(0, 40)}"): il campo non l'ha accettato${said}` };
        if (said) return { id: it.id, warn: true, note: `⚠ ${it.id} "${it.name}"${said}` };
        if (viaScript) return { id: it.id, note: `${it.id} e' in sola lettura: valore impostato via script, verifica che il portale lo accetti` };
        return { id: it.id };
      }
      case 'select': {
        const { it, el } = await target(st.select);
        if (it.s === 'x') return { block: `!x ${it.id} "${it.name}": campo riservato, lo compila l'utente` };
        if (it.role !== 'sel') throw new Error(`${it.id} non e' un <select>: per menu personalizzati usa "click" e poi "pick"`);
        const opt = st.option ?? st.value ?? st.text;
        if (opt === undefined || opt === '') throw new Error(`manca "option": es. {"select":"${it.name}","option":"testo dell'opzione"}`);
        const want = (Array.isArray(opt) ? opt : [opt]).map((x) => String(x ?? ''));
        try {
          await el.selectOption(want, { timeout: 3000 });
        } catch {
          const vals = await el.evaluate((s, w) => {
            const n = (x) => (x || '').replace(/\s+/g, ' ').trim().toLowerCase();
            return w.map((x) => {
              const o = [...s.options].find((o) => n(o.label || o.text) === n(x)) || [...s.options].find((o) => n(o.label || o.text).includes(n(x)));
              return o ? o.value : null;
            });
          }, want);
          const miss = want.filter((_, k) => vals[k] === null);
          if (miss.length) throw new Error(`opzione non trovata: ${miss.join(', ')} (browse_read describe ${it.id} per l'elenco)`);
          await el.selectOption(vals.map((value) => ({ value })), { timeout: 3000 });
        }
        await after(1500);
        const now = await el.evaluate((s) => [...s.selectedOptions].map((o) => (o.label || o.text).trim())).catch(() => null);
        if (now && !now.length) return { id: it.id, note: `${it.id} risulta senza selezione: il componente ha annullato la scelta` };
        return { id: it.id };
      }
      case 'check': {
        const { it, el } = await target(st.check);
        const want = st.on !== false;
        if (!/^(chk|rad|sw)$/.test(it.role)) throw new Error(`${it.id} non e' una casella`);
        if (want) {
          const why = this.needConfirm(it, 'check', st);
          if (why) return { block: why };
        }
        try {
          await el.setChecked(want, { timeout: 3000 });
        } catch (e) {
          const lab = await el.evaluateHandle((x) => (x.labels && x.labels[0]) || null);
          const le = lab.asElement();
          if (!le) throw e;
          const cur = await el.evaluate((x) => !!x.checked);
          if (cur !== want) await le.click({ timeout: 3000 });
        }
        await after(800);
        const now = await el.evaluate((x) => (typeof x.checked === 'boolean' ? x.checked : x.getAttribute('aria-checked') === 'true'));
        if (now !== want) return { id: it.id, note: `${it.id} e' ancora ${now ? 'selezionato' : 'non selezionato'}` };
        return { id: it.id };
      }
      case 'press': {
        const key = String(st.press);
        let it = null;
        let el = null;
        if (st.target !== undefined) ({ it, el } = await target(st.target));
        if (key === 'Enter' && this.cfg.confirmSensitive && st.confirm !== true) {
          const submits = el
            ? await el.evaluate(enterSubmits)
            : await page.evaluate(() => {
                const a = document.activeElement;
                if (!a || !a.form) return false;
                const f = a.form;
                if (f.getAttribute('role') === 'search' || f.querySelector('input[type=search]')) return false;
                return !/search|cerca|ricerca|query|^q$/i.test([a.name, a.id, a.getAttribute('aria-label'), a.placeholder].join(' '));
              });
          if (submits) return { block: `!c Enter invia il modulo${it ? ' (' + it.id + ')' : ''}: chiedi conferma all'utente, poi ripeti con "confirm": true` };
        }
        let g = { note: '' };
        if (key === 'Enter') {
          g = await this.humanGate(page, el);
          if (g.stuck) return { block: g.note };
        }
        if (el) await el.press(key, { timeout: 5000 });
        else await page.keyboard.press(key);
        await after(6000, 300);
        return g.note ? { note: g.note } : undefined;
      }
      case 'pick': {
        const text = String(st.pick);
        const loc = page.locator(PICK_SEL).filter({ hasText: text }).filter({ visible: true });
        await loc.first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {
          throw new Error(`nessun suggerimento visibile con "${text}": prima "type" nel campo, poi "pick"`);
        });
        const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
        const texts = (await loc.allInnerTexts().catch(() => [])).slice(0, 30);
        const idx = Math.max(0, texts.findIndex((t) => norm(t) === norm(text)));
        await loc.nth(idx).click({ timeout: 4000 });
        await after(2500, 150);
        return;
      }
      case 'hover': {
        const { el } = await target(st.hover);
        await el.hover({ timeout: 4000 });
        await after(800);
        return;
      }
      case 'scroll': {
        const s = st.scroll;
        if (typeof s === 'number' || (s && typeof s === 'object' && s.name === undefined && (typeof s.y === 'number' || typeof s.x === 'number') && (Math.abs(s.y || 0) > 1 || Math.abs(s.x || 0) > 1))) {
          // pixel: scroll:300 (giu'), scroll:-300 (su), scroll:{x,y}
          const dx = typeof s === 'number' ? 0 : Number(s.x) || 0;
          const dy = typeof s === 'number' ? s : Number(s.y) || 0;
          await page.mouse.wheel(dx, dy);
        } else if (s === 'down' || s === 'up') await page.mouse.wheel(0, (s === 'down' ? 1 : -1) * Math.round(this.stats.vh * 0.85));
        else if (s === 'top' || s === 'bottom') await page.evaluate((b) => window.scrollTo(0, b ? document.documentElement.scrollHeight : 0), s === 'bottom');
        else {
          const { el } = await target(s);
          await el.scrollIntoViewIfNeeded({ timeout: 3000 });
        }
        await after(800);
        return;
      }
      case 'wait': {
        if (st.wait === 'idle') {
          const t0 = Date.now();
          const ok = await this.settle(page, 15000, 500, 300);
          const s = ((Date.now() - t0) / 1000).toFixed(1);
          return { note: ok ? `pagina stabile dopo ${s} s` : 'pagina ancora in caricamento dopo 15 s' };
        }
        await page.waitForTimeout(Math.min(Math.max(0, Number(st.wait) || 0), 10000));
        return;
      }
      case 'waitFor': {
        const t = String(st.waitFor);
        const ms = Math.min(Math.max(Number(st.timeout) || 15000, 300), 15000);
        // il testo compare spesso prima in elementi nascosti (menu chiusi, modelli): si attende la prima copia VISIBILE
        await page
          .getByText(t)
          .filter({ visible: true })
          .first()
          .waitFor({ state: 'visible', timeout: ms })
          .catch(async () => {
            const n = await page.getByText(t).count().catch(() => 0);
            const s = ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
            throw new Error(n ? `testo "${t}" presente (${n}) ma non visibile entro ${s}` : `testo "${t}" non apparso entro ${s}`);
          });
        await after(800);
        return;
      }
      case 'goto': {
        const u = this.checkUrl(String(st.goto), { strip: true });
        ({ page } = await this.nav(page, u));
        await after(8000, 300);
        const ck = await this.dismissCookies(page);
        const pop = await this.dismissPopup(page);
        const nn = [ck && `cookie rifiutati (${ck})`, pop].filter(Boolean).join('; ');
        if (nn) return { note: nn };
        return;
      }
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await after(4000, 200);
        return;
      case 'tab': {
        const pages = this.ctx.pages().filter((p) => !p.isClosed() && !this.inUse.has(p));
        if (st.tab === 'close') {
          if (pages.length < 2) throw new Error("e' l'unica scheda aperta");
          await within(page.close(), 5000).catch(() => {});
          this.page = this.ctx.pages().filter((p) => !p.isClosed() && !this.inUse.has(p)).pop();
        } else if (st.tab === 'list') {
          const url = (p) => {
            try {
              return p.url();
            } catch {
              return '?';
            }
          };
          return { note: 'schede: ' + pages.map((p, k) => `${k + 1}${p === page ? '*' : ''} ${url(p)}`).join(' | ') };
        } else {
          const p = pages[Number(st.tab) - 1];
          if (!p) throw new Error(`scheda ${st.tab} inesistente (aperte: ${pages.length})`);
          this.page = p;
        }
        await within(this.page.bringToFront(), 3000).catch(() => {});
        return;
      }
      case 'upload': {
        const { it, el } = await target(st.upload);
        if (this.cfg.confirmSensitive && st.confirm !== true) return { block: `!c caricamento di ${[].concat(st.file).join(', ')} su ${it.id} "${it.name}": chiedi conferma all'utente, poi ripeti con "confirm": true` };
        const files = [].concat(st.file || []).map((f) => String(f).replace(/^~(?=$|[\\/])/, os.homedir()));
        if (!files.length) throw new Error('indica "file": percorso o elenco di percorsi');
        for (const f of files) if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('file non trovato: ' + f);
        let how = '';
        if (it.role === 'file') await el.setInputFiles(files, { timeout: 5000 });
        else {
          // area "trascina qui": prima l'input file dentro l'area, poi il file chooser del clic, poi un input vicino
          const near = await el.evaluateHandle((e) => e.querySelector('input[type=file]'));
          const inp = near.asElement();
          if (inp) {
            await inp.setInputFiles(files, { timeout: 5000 });
            how = " (input file dell'area)";
          } else {
            await near.dispose();
            try {
              const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 6000 }), el.click({ timeout: 5000 })]);
              await fc.setFiles(files);
              how = ' (finestra di scelta file)';
            } catch (e) {
              const h = await el.evaluateHandle((e) => {
                for (let a = e.parentElement, k = 0; a && k < 3 && a !== document.body; a = a.parentElement, k++) {
                  const c = a.querySelectorAll('input[type=file]');
                  if (c.length) return c.length === 1 ? c[0] : null;
                }
                const all = document.querySelectorAll('input[type=file]');
                return all.length === 1 ? all[0] : null;
              });
              const only = h.asElement();
              if (!only) throw new Error(`${it.id} non apre la scelta dei file e non ha un campo file vicino: indica il campo (browse_view scope:"areas")`);
              await only.setInputFiles(files, { timeout: 5000 });
              how = ' (campo file vicino)';
            }
          }
        }
        await after(1500);
        return { note: `caricati ${files.length} file${how}` };
      }
      case 'find': {
        const t = await this.read({ mode: 'find', query: String(st.find), max: st.max || 10 });
        this.stats.observations--;
        return { note: `testo con "${st.find}":\n${t}` };
      }
      case 'read': {
        const ref = typeof st.target === 'string' ? st.target : undefined;
        if (st.read === 'describe') {
          if (!ref) throw new Error('read:"describe" vuole "target": ref dell\'elemento');
          const t = await this.read({ mode: 'describe', ref });
          this.stats.observations--;
          return { note: `${ref}:\n${t}` };
        }
        const mode = ['table', 'cards', 'fields'].includes(st.read) ? st.read : 'text';
        const t = await this.read({ mode, ref, max: st.max, links: st.links, query: st.query, sort: st.sort, filter: st.filter, maxPrice: st.maxPrice });
        this.stats.observations--;
        return { note: `${{ table: 'tabella', cards: 'schede', text: 'testo', fields: 'campi' }[mode]}:\n${t}` };
      }
      case 'dialog': {
        if (st.dialog === 'accept') {
          if (this.cfg.confirmSensitive && st.confirm !== true) return { block: "accettare la prossima finestra di conferma richiede \"confirm\": true (chiedi all'utente)" };
          this.dialogAccept = true;
          return { note: 'la prossima finestra di conferma verra\' accettata' };
        }
        this.dialogAccept = false;
        return;
      }
    }
  }

  /** Testo di un PDF: query = file locale o URL; senza query il PDF aperto nella scheda o l'ultimo scaricato. */
  async readPdf({ query, offset = 0, max }) {
    let src = null;
    const fromBuf = async (buf, label) => {
      const tmp = path.join(os.tmpdir(), `colibri-${process.pid}-${Date.now()}.pdf`);
      fs.writeFileSync(tmp, buf);
      try {
        return { label, ...pdfText(tmp) };
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    };
    const fetchPdf = async (u) => {
      const res = await this.ctx.request.get(u, { timeout: 30000 });
      if (!res.ok()) throw new Error(`PDF non scaricabile: HTTP ${res.status()}`);
      return fromBuf(await res.body(), u);
    };
    const q = (query || '').trim().replace(/^~(?=$|[\\/])/, os.homedir());
    if (q && /^https?:/i.test(q)) {
      await this.ensure();
      src = await fetchPdf(this.checkUrl(q));
    } else if (q) {
      // solo PDF nella cartella dei download: il testo delle pagine non deve poter far leggere file dell'utente
      const full = path.resolve(path.isAbsolute(q) ? q : path.join(this.cfg.downloadsDir, q));
      const rel = path.relative(path.resolve(this.cfg.downloadsDir), full);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`solo PDF nella cartella download (${this.cfg.downloadsDir})`);
      if (!fs.existsSync(full)) throw new Error('file non trovato: ' + full);
      src = { label: full, ...pdfText(full) };
    } else {
      const page = this.page && !this.page.isClosed() ? this.page : null;
      const isPdf = page && (await page.evaluate(() => document.contentType === 'application/pdf').catch(() => false));
      if (isPdf) src = await fetchPdf(page.url());
      else if (this.lastPdf) src = { label: this.lastPdf.file, ...this.lastPdf };
      else throw new Error('nessun PDF: indica "query" con il percorso o l\'URL');
    }
    if (!src.text) return `${src.label}: ${src.pages} pag., nessun testo estraibile (PDF scansionato o con caratteri incorporati senza mappa)`;
    const lim = max || 4000;
    const part = src.text.slice(offset, offset + lim);
    const more = src.text.length - offset - part.length;
    return `${src.label} (${src.pages} pag.)\n${part}` + (more > 0 ? `\n… altri ${more} caratteri (offset:${offset + part.length})` : '');
  }

  // ---------- tool: read ----------
  async read(o = {}) {
    const { mode = 'text', ref, selector, query, offset = 0, max, links, sort, filter, maxPrice, url } = o;
    if (url && mode !== 'pdf') return this.readUrl(o);
    const page = await this.ensure();
    this.stats.observations++;
    let frame = page.mainFrame();
    if (ref) {
      const snap = await this.collect();
      const it = snap.items.find((i) => i.id === ref);
      if (it) frame = it.frame;
      else {
        const m = /^(f\d+)/.exec(ref);
        if (m) {
          const f = page.frames().find((x) => this.frameIds.get(x) === m[1]);
          if (f) frame = f;
        }
      }
    }
    if (mode === 'pdf') return this.readPdf({ query, offset, max });
    if (mode !== 'describe') {
      // risultati caricati dopo un clic (SPA): si attende la fine delle richieste (e degli spinner solo se la rete
      // e' occupata: uno spinner decorativo sempre visibile non deve rallentare ogni lettura), non i testi
      const net = this.net.get(page);
      const now = Date.now();
      const busy = net && [...net.values()].some((t) => now - t < 8000);
      if (busy) await this.settle(page, 8000, 0);
      await this.settle(page, 600, 120);
    }
    if (mode === 'cards') {
      if (!ref) await this.collect();
      const once = async () => {
        await evalIn(frame, P.priceHelperInPage, undefined, 3000).catch(() => {});
        return evalIn(frame, P.readCardsInPage, { ref, selector, links: !!links }, 15000);
      };
      let r = await once();
      if (r.err && !selector) {
        // elenchi caricati dopo (pagine di categoria che si ricaricano o completano la griglia): si riprova una volta
        await this.settle(page, 5000, 300);
        if (!ref) await this.collect();
        r = await once();
        if (r.err) {
          const ch = await this.challenge(page);
          if (ch && ch.block) throw new Error(`${r.err} (la pagina mostra ${ch.hard ? 'un blocco del sito' : 'una verifica ' + ch.kind}: browse_view)`);
        }
      }
      if (r.err) throw new Error(r.err);
      return cardsOut(r, { offset, max: max || 20, sort, filter, maxPrice });
    }
    if (mode === 'fields') {
      if (!query) throw new Error('serve "query": chiavi separate da virgola (es. "classe energetica, dimensioni, colore, prezzo")');
      await evalIn(frame, P.priceHelperInPage, undefined, 3000).catch(() => {});
      const d = await evalIn(frame, P.specPairsInPage, undefined, 10000);
      const u = page.url();
      this.cacheSet(u, 'spec', d);
      return this.fieldsOut(d, query, u);
    }
    if (mode === 'find') {
      if (!query) throw new Error('serve "query"');
      const hits = [];
      for (const f of page.frames()) {
        try {
          const r = await evalIn(f, P.findTextInPage, { query, max: max || 20 }, 4000);
          hits.push(...r.hits);
        } catch {}
        if (hits.length >= (max || 20)) break;
      }
      return hits.length ? hits.slice(0, max || 20).join('\n') : `nessuna riga contiene "${query}"`;
    }
    if (mode === 'describe') {
      if (!ref) throw new Error('serve "ref"');
      const r = await frame.evaluate(P.describeInPage, ref);
      if (r.err) throw new Error(r.err);
      const o = [`${r.tag}${r.type ? '[' + r.type + ']' : ''}`];
      if (r.text) o.push('testo: ' + r.text);
      if (r.value !== undefined) o.push('valore: ' + r.value);
      if (r.selected) o.push('selezionato: ' + r.selected.join(', '));
      if (r.options) o.push(`opzioni (${r.options.length}): ` + r.options.join(' | '));
      if (r.href) o.push('href: ' + r.href);
      if (r.box) o.push(`box (0-1): left ${r.box.l} top ${r.box.t} right ${r.box.r} bottom ${r.box.b}${r.box.in ? '' : ' (fuori dalla vista)'}`);
      return o.join('\n');
    }
    if (mode === 'table') {
      const r = await frame.evaluate(P.readTableInPage, { ref, selector, offset, maxRows: max || 40 });
      if (r.err) throw new Error(r.err);
      const more = r.total - offset - r.rows.length;
      return `righe ${offset + 1}-${offset + r.rows.length} di ${r.total}\n` + r.rows.join('\n') + (more > 0 ? `\n… altre ${more} (offset:${offset + r.rows.length})` : '');
    }
    const r = await frame.evaluate(P.readTextInPage, { ref, selector, offset, maxChars: max || 3000 });
    if (r.err) throw new Error(r.err);
    const more = r.total - offset - r.text.length;
    const cut = r.cut > 200 && !offset ? `[solo contenuto principale: esclusi ${r.cut} caratteri di menu e link; selector:"body" per tutto]\n` : '';
    return cut + r.text + (more > 0 ? `\n… altri ${more} caratteri (offset:${offset + r.text.length})` : '');
  }

  cacheSet(url, kind, v) {
    const k = String(url).replace(/#.*$/, '');
    const e = this.cache.get(k) || {};
    e[kind] = { at: Date.now(), v };
    this.cache.delete(k);
    this.cache.set(k, e);
    while (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
  }

  cacheGet(url, kind, ttl = 600000) {
    const e = this.cache.get(String(url).replace(/#.*$/, ''));
    const x = e && e[kind];
    return x && Date.now() - x.at < ttl ? x.v : null;
  }

  /** Lo stesso modello letto su siti diversi con valori diversi: avviso, l'utente decide quale fonte vale. */
  fact(title, url, key, v) {
    const toks = modelTokens(title);
    const fk = fold(key).trim();
    if (!toks.length || PRICE_KEY.test(fk)) return '';
    const fv = fold(v).replace(/\s+/g, '');
    const host = hostOf(url);
    let w = '';
    for (const f of this.facts) {
      if (w || f.host === host || f.key !== fk || f.v === fv || !f.toks.some((t) => toks.includes(t))) continue;
      w = `⚠ ${key}: "${v}" qui, "${f.raw}" su ${f.host} (stesso modello): verifica la fonte`;
    }
    this.facts = this.facts.filter((f) => !(f.url === url && f.key === fk));
    this.facts.push({ url, host, key: fk, v: fv, raw: v, toks });
    if (this.facts.length > 300) this.facts.shift();
    return w;
  }

  fieldsOut(d, query, url) {
    const keys = String(query).split(/[,;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const out = [];
    const warn = [];
    for (const key of keys) {
      const v = fieldOf(d, key);
      out.push(`${key}: ${v === null ? 'non trovato' : v}`);
      if (v !== null) {
        const w = this.fact(d.title, url, key, v);
        if (w) warn.push(w);
      }
    }
    const miss = out.filter((l) => l.endsWith(': non trovato')).length;
    return (
      (d.title ? d.title + '\n' : '') +
      out.join('\n') +
      (warn.length ? '\n' + warn.join('\n') : '') +
      (miss && miss === keys.length ? `\n(nessuna chiave trovata tra ${d.pairs.length} coppie: prova mode "find" con una parola)` : '')
    );
  }

  /**
   * Lettura di un altro URL in una scheda di sfondo (o dalla cache se letto da meno di 10 minuti):
   * la pagina attiva non cambia e piu' letture possono andare insieme.
   */
  async readUrl({ url, mode = 'text', query, offset = 0, max, sort, filter, maxPrice, fresh }) {
    const u = this.checkUrl(String(url), { strip: true });
    if (!['text', 'find', 'fields', 'cards', 'table'].includes(mode)) throw new Error('con "url": mode text, find, fields, cards o table');
    if (mode === 'fields' && !query) throw new Error('serve "query": chiavi separate da virgola');
    if (mode === 'find' && !query) throw new Error('serve "query"');
    const kind = { fields: 'spec', cards: 'cards', table: 'table' }[mode] || 'text';
    let c = fresh ? null : this.cacheGet(u, kind);
    const cached = !!c;
    if (!c) {
      let page = await this.bgPage();
      try {
        let resp;
        ({ page, resp } = await this.nav(page, u));
        await this.settle(page, 6000, 200, 200);
        const ch = await this.challenge(page);
        if (ch && ch.block)
          throw new Error(ch.hard ? `il sito ${hostOf(u)} ha bloccato il browser: usa un'altra fonte` : `${hostOf(u)} chiede una verifica (${ch.kind}): aprila con browse_open per risolverla`);
        const st = resp ? resp.status() : 0;
        if (st >= 400) throw new Error(`HTTP ${st}: pagina inesistente o non accessibile (${u})`);
        const f = page.mainFrame();
        await evalIn(f, P.priceHelperInPage, undefined, 3000).catch(() => {});
        if (kind === 'spec') c = await evalIn(f, P.specPairsInPage, undefined, 10000);
        else if (kind === 'cards') {
          c = await evalIn(f, P.readCardsInPage, { links: true }, 15000);
          if (c.err) {
            await this.settle(page, 5000, 300);
            await evalIn(f, P.priceHelperInPage, undefined, 3000).catch(() => {});
            c = await evalIn(f, P.readCardsInPage, { links: true }, 15000);
          }
          if (c.err) throw new Error(c.err);
          c.items = c.items.map((it) => ({ ...it, row: noRefs(it.row) }));
        } else if (kind === 'table') {
          c = await evalIn(f, P.readTableInPage, { offset: 0, maxRows: 400 }, 10000);
          if (c.err) throw new Error(c.err);
        } else c = await evalIn(f, P.readTextInPage, { offset: 0, maxChars: 80000 }, 10000);
        this.cacheSet(u, kind, c);
      } finally {
        await this.bgClose(page);
      }
    }
    this.stats.observations++;
    const head = `${u.replace(/^https?:\/\/(www\.)?/, '')}${cached ? ' (dalla cache)' : ''}\n`;
    if (kind === 'spec') return head + this.fieldsOut(c, query, u);
    if (kind === 'cards') return head + cardsOut(c, { offset, max: max || 20, sort, filter, maxPrice });
    if (kind === 'table') {
      const lim = max || 40;
      const rows = c.rows.slice(offset, offset + lim);
      const more = c.rows.length - offset - rows.length;
      return head + `righe ${offset + 1}-${offset + rows.length} di ${c.rows.length}\n` + rows.join('\n') + (more > 0 ? `\n… altre ${more} (offset:${offset + rows.length})` : '');
    }
    if (mode === 'find') {
      const q = fold(query).trim();
      const n = max || 20;
      const hits = c.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && fold(l).includes(q))
        .slice(0, n)
        .map((l) => (l.length > 200 ? l.slice(0, 199) + '…' : l));
      return head + (hits.length ? hits.join('\n') : `nessuna riga contiene "${query}"`);
    }
    const lim = max || 3000;
    const t = c.text.slice(offset, offset + lim);
    const more = c.text.length - offset - t.length;
    return head + t + (more > 0 ? `\n… altri ${more} caratteri (offset:${offset + t.length})` : '');
  }

  // ---------- tool: screenshot ----------
  async screenshot({ ref, labels, region } = {}) {
    if (!this.cfg.allowScreenshot) throw new Error('screenshot disattivati nelle impostazioni');
    const page = await this.ensure();
    let clip;
    if (labels) {
      await this.collect();
      await page.mainFrame().evaluate(P.labelsInPage).catch(() => 0);
    }
    if (region && region.length === 4) {
      const v = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, x: scrollX, y: scrollY }));
      const [x0, y0, x1, y1] = region.map((n) => Math.min(1, Math.max(0, Number(n) || 0)));
      if (x1 <= x0 || y1 <= y0) throw new Error('region: servono [sinistra, alto, destra, basso] con valori 0-1 crescenti');
      clip = { x: v.x + x0 * v.w, y: v.y + y0 * v.h, width: (x1 - x0) * v.w, height: (y1 - y0) * v.h };
    } else if (ref) {
      const snap = await this.collect();
      const it = snap.items.find((i) => i.id === ref);
      if (!it) throw new Error(`${ref} non trovato`);
      const el = await this.handle(it);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const b = await el.boundingBox();
      if (!b) throw new Error('elemento senza area visibile');
      clip = { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 };
    } else {
      const v = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, x: scrollX, y: scrollY }));
      clip = { x: v.x, y: v.y, width: v.w, height: v.h };
    }
    const scale = Math.min(1, 1024 / clip.width, 768 / clip.height);
    const cdp = await page.context().newCDPSession(page);
    try {
      const res = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 55, captureBeyondViewport: !!ref,
        clip: { ...clip, scale },
      });
      const w = Math.round(clip.width * scale);
      const h = Math.round(clip.height * scale);
      const tok = Math.ceil((w * h) / 750);
      this.stats.shots++;
      this.stats.shotTokens += tok;
      this.stats.observations++;
      return { data: res.data, w, h, tok };
    } finally {
      await cdp.detach().catch(() => {});
      if (labels) await page.mainFrame().evaluate(P.clearLabelsInPage).catch(() => {});
    }
  }

  // ---------- tool: task ----------
  async task(a = {}) {
    return runTask(this, a);
  }

  // ---------- consumo ----------
  record(text, ms) {
    this.stats.calls++;
    this.stats.chars += text.length;
    this.stats.toolMs += ms;
  }

  statsText() {
    const s = this.stats;
    const own = estTokens('x'.repeat(s.chars)) + s.shotTokens;
    const shotTok = Math.min(1600, Math.ceil((s.vw * s.vh) / 750));
    const classicCalls = s.actions + s.observations;
    const classicTok = classicCalls * shotTok;
    const pct = classicTok ? Math.round((1 - own / classicTok) * 100) : 0;
    return [
      `sessione: ${s.calls} chiamate, ${s.actions} azioni, ${s.observations} osservazioni, ${s.shots} screenshot`,
      `token prodotti dai tool: ~${own.toLocaleString('it-IT')} (stima ~3,6 caratteri/token${s.shotTokens ? ', screenshot inclusi' : ''})`,
      `stesso lavoro con 1 screenshot per azione/osservazione: ~${classicCalls} chiamate, ~${classicTok.toLocaleString('it-IT')} token (${shotTok} token/screenshot a ${s.vw}x${s.vh})`,
      classicTok ? `risparmio stimato sulle osservazioni: ~${pct}% e ${Math.max(0, classicCalls - s.calls)} chiamate in meno (ogni chiamata in meno evita di rileggere tutto il contesto)` : '',
      `tempo nel browser: ${(s.toolMs / 1000).toFixed(1)} s totali`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  async close() {
    try {
      if (this.cfg.mode === 'cdp') {
        // Chrome dell'utente: mai chiuderlo. Si chiudono solo le schede aperte da Colibri (lasciandone sempre
        // almeno una, altrimenti Chrome si chiuderebbe con l'ultima finestra) e ci si scollega.
        if (this.ctx) {
          const open = this.ctx.pages().filter((p) => !p.isClosed());
          let left = open.length;
          for (const p of open) {
            if (!this.owned.has(p)) continue;
            if (left > 1) {
              await p.close().catch(() => {});
              left--;
            } else await p.goto('about:blank').catch(() => {});
          }
        }
        // con connectOverCDP close() chiude solo la connessione, non il processo di Chrome
        if (this.browser) await this.browser.close();
      } else if (this.ctx) await this.ctx.close();
    } catch {}
    this.reset();
  }
}

function enterSubmits(a) {
  if (!a || !a.form) return false;
  const f = a.form;
  if (f.getAttribute('role') === 'search' || f.querySelector('input[type=search]')) return false;
  if (a.tagName === 'TEXTAREA') return false;
  return !/search|cerca|ricerca|query|^q$/i.test([a.name, a.id, a.getAttribute('aria-label'), a.placeholder].join(' '));
}
