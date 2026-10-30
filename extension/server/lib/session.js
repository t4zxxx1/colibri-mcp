import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import * as P from './page-script.js';
import { renderView, renderDiff, snapKeys, lineOf, estTokens, readCover } from './render.js';
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
    this.frameIds = new WeakMap();
    this.frameN = 0;
    this.idN = 0;
    this.newPages = [];
    this.owned = new Set();
    this.refInfo = new Map();
    this.acting = false;
    this.events = [];
    this.pending = new Set();
    this.net = new WeakMap();
    this.dialogAccept = false;
    this.last = null; // { page, url, modal, keys }
    this.PICK_SEL = PICK_SEL;
    this.stats = { calls: 0, chars: 0, actions: 0, observations: 0, shots: 0, shotTokens: 0, toolMs: 0, vw: 1280, vh: 800 };
  }

  // ---------- avvio e gestione browser ----------
  async ensure() {
    if (this.ctx && this.page && !this.page.isClosed()) return this.page;
    if (this.ctx) {
      const pages = this.ctx.pages().filter((p) => !p.isClosed());
      this.page = pages[pages.length - 1];
      if (!this.page) {
        this.page = await this.ctx.newPage();
        this.owned.add(this.page);
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

  // schede aperte da un clic: la prima utile diventa attiva; quelle rimaste vuote o su domini di
  // pubblicita'/affiliazione si chiudono (solo se aperte da Colibri)
  async adoptNewPages() {
    const list = this.newPages.filter((p) => !p.isClosed());
    this.newPages = [];
    const notes = [];
    let keep = null;
    for (const p of list) {
      await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      // redirect di affiliazione o popup che parte vuoto: si lascia il tempo di arrivare alla pagina vera
      if (isJunkUrl(p.url())) await p.waitForURL((u) => !isJunkUrl(String(u)), { timeout: 4000, waitUntil: 'commit' }).catch(() => {});
    }
    for (const p of list) {
      if (p.isClosed()) continue;
      if (isJunkUrl(p.url()) && this.owned.has(p)) {
        notes.push(`chiusa scheda inutile (${hostOf(p.url()) || 'vuota'})`);
        await p.close().catch(() => {});
      } else keep = p;
    }
    if (keep) {
      this.page = keep;
      await keep.bringToFront().catch(() => {});
      notes.push(`aperta nuova scheda, ora attiva (${keep.url()})`);
    }
    return notes;
  }

  // schede di sfondo aperte da Colibri: via le vuote, le doppie, quelle pubblicitarie e oltre le 3 piu' recenti
  async tidyTabs() {
    if (!this.ctx) return '';
    const bg = this.ctx.pages().filter((p) => !p.isClosed() && p !== this.page && this.owned.has(p));
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
      if (f === p.mainFrame()) net.clear();
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
          r = JSON.parse(isMain ? await f.evaluate(P.collectInPage, arg) : await evalIn(f, P.collectInPage, arg, 4000));
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
        st = await page.mainFrame().evaluate((spin) => {
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
        }, maxMs >= 4000);
      } catch {
        if (navWaits++ > 3) return;
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: Math.max(1000, 15000 - (Date.now() - t0)) });
        } catch {}
        continue;
      }
      const now = Date.now();
      let busy = 0;
      if (net) for (const t of net.values()) if (now - t < 8000) busy++;
      // uno spinner sempre visibile (decorativo) non deve bloccare oltre 6 s
      const spinning = st.s && now - t0 < 6000;
      if (now - t0 >= minMs && st.r !== 'loading' && st.m >= quietMs && busy === 0 && !spinning) return true;
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
  async open(url, { rows, filter } = {}) {
    let page = await this.ensure();
    const u = this.checkUrl(url);
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
    const snap = await this.collect();
    this.remember(snap);
    this.stats.observations++;
    let txt = renderView(snap, { url: page.url(), tabs: this.tabs(), max: this.cfg.maxItems, rows, filter });
    if (ck) txt = `cookie: rifiutati i non necessari (${ck})\n` + txt;
    if (g.note) txt = g.note + '\n' + txt;
    const ev = this.events.splice(0);
    if (ev.length) txt = ev.join('\n') + '\n' + txt;
    const pdf = await page.evaluate(() => document.contentType === 'application/pdf').catch(() => false);
    if (pdf) txt = 'documento PDF: testo con browse_read mode "pdf"\n' + txt;
    if (!this.allowedUrl(page.url())) txt = `ATTENZIONE: ${new URL(page.url()).hostname} e' fuori dai domini consentiti, le azioni sono bloccate\n` + txt;
    const tpl = this.savedFilters(page.url());
    if (tpl) txt += '\n' + tpl;
    return txt;
  }

  // ---------- tool: search ----------
  async search({ query, max = 8 }) {
    const q = String(query || '').trim();
    if (!q) throw new Error('serve "query"');
    const urls = [];
    let denied = null;
    for (const s of this.cfg.searchUrls) {
      try {
        urls.push(this.checkUrl((s.includes('{q}') ? s : s + '{q}').replace('{q}', encodeURIComponent(q))));
      } catch (e) {
        denied = denied || e;
      }
    }
    if (!urls.length) throw denied;
    let page = await this.ensure();
    const n = Math.min(Math.max(1, max), 20);
    const notes = [];
    let rows = [];
    for (const [k, u] of urls.entries()) {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
      }
      rows = await page.evaluate(P.searchResultsInPage, { max: n }).catch(() => []);
      if (rows.length || last) {
        if (k) notes.push(`risultati da ${host}`);
        break;
      }
      notes.push(`${host}: nessun risultato leggibile, uso il motore successivo`);
    }
    this.remember(await this.collect());
    this.stats.observations++;
    const short = (s) => s.replace(/^https:\/\//, '');
    const head = (notes.length ? notes.join('; ') + '\n' : '') + `ricerca "${q}": ${rows.length} risultati`;
    if (!rows.length) return head + ' (pagina aperta: browse_view per vederla)';
    return head + '\n' + rows.map((r, i) => `${i + 1}. ${r.title} | ${short(r.url)}${r.snip ? ' | ' + r.snip : ''}`).join('\n');
  }

  checkUrl(url) {
    let u;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url);
    } catch {
      throw new Error('URL non valido: ' + url);
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error(`schema ${u.protocol} non consentito (solo http/https)`);
    if (!this.allowedUrl(u.href)) throw new Error(`${u.hostname} non e' tra i domini consentiti (${this.cfg.allowed.join(', ')})`);
    return u.href;
  }

  // ---------- tool: view ----------
  async view(opts = {}) {
    let page = await this.ensure();
    const g = await this.humanGate(page);
    page = g.page;
    const areas = opts.scope === 'areas';
    const snap = await this.collect({ areas });
    this.stats.observations++;
    if (areas) {
      const list = snap.items.filter((i) => i.role === 'area' || i.hid);
      this.remember(snap);
      const head = `aree cliccabili senza nome: ${list.length} (nome ~file = immagine, LxA @x,y = centro 0-1)`;
      return [g.note, head, ...list.map((i) => lineOf(i, true)), list.length ? 'usa il ref con click/hover/upload' : 'nessuna: prova browse_screenshot'].filter(Boolean).join('\n');
    }
    if (!opts.filter && !opts.offset) this.remember(snap);
    const txt = renderView(snap, { url: page.url(), tabs: this.tabs(), max: this.cfg.maxItems, ...opts });
    return g.note ? g.note + '\n' + txt : txt;
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

  async run(steps, { view = 'diff' } = {}) {
    let page = await this.ensure();
    const notes = [];
    let done = 0;
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
        const r = await this.step(act, st, snap, page);
        if (r && r.block) {
          stop = `${tag}: BLOCCATO ${r.block}`;
          break;
        }
        if (r && r.note) notes.push(`${tag}: ${r.note}`);
        if (r && r.note && (act === 'read' || act === 'find')) readText += '\n' + r.note;
        if (r && r.id && (act === 'fill' || act === 'check')) touched.set(r.id, act);
        if (act === 'select' && this.trail.length && st.option !== undefined) this.trail[this.trail.length - 1] += '=' + [].concat(st.option).join('/');
        if (act === 'pick') this.trail.push(String(st.pick).slice(0, 30));
        done++;
        this.stats.actions++;
      } catch (e) {
        stop = `${tag} (${act}): errore: ${firstLine(e)}`;
        break;
      }
      if (this.newPages.length) for (const n of await this.adoptNewPages()) notes.push(`${tag}: ${n}`);
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
    const head = [`ok ${done}/${steps.length}` + (stop ? ' · ' + stop : '')];
    head.push(...notes, ...this.events.splice(0));

    let body = '';
    if (view !== 'none') {
      const navigated = page.url() !== startUrl || this.last.page !== page;
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
          try {
            await el.click({ timeout: 5000 });
          } catch (e) {
            const m = String(e && e.message).match(/(<[^>\n]{1,90}>)[^\n]*intercepts pointer events/);
            if (m) throw new Error(`${it.id} coperto da ${m[1]}: chiudi l'elemento sovrapposto oppure ripeti con "force": true`);
            throw e;
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
        const v = await el.evaluate((e) => ('value' in e ? e.value : e.innerText || '')).catch(() => null);
        if (v !== null && act === 'fill' && v.trim() !== text.trim()) return { id: it.id, note: `${it.id} valore ora "${String(v).slice(0, 60)}" (richiesto "${text.slice(0, 40)}")` };
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
        if (s === 'down' || s === 'up') await page.mouse.wheel(0, (s === 'down' ? 1 : -1) * Math.round(this.stats.vh * 0.85));
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
        const u = this.checkUrl(String(st.goto));
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await after(8000, 300);
        const ck = await this.dismissCookies(page);
        if (ck) return { note: `cookie rifiutati (${ck})` };
        return;
      }
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await after(4000, 200);
        return;
      case 'tab': {
        const pages = this.ctx.pages().filter((p) => !p.isClosed());
        if (st.tab === 'close') {
          if (pages.length < 2) throw new Error("e' l'unica scheda aperta");
          await page.close();
          this.page = this.ctx.pages().filter((p) => !p.isClosed()).pop();
        } else if (st.tab === 'list') {
          return { note: 'schede: ' + pages.map((p, k) => `${k + 1}${p === page ? '*' : ''} ${p.url()}`).join(' | ') };
        } else {
          const p = pages[Number(st.tab) - 1];
          if (!p) throw new Error(`scheda ${st.tab} inesistente (aperte: ${pages.length})`);
          this.page = p;
        }
        await this.page.bringToFront().catch(() => {});
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
        const mode = ['table', 'cards'].includes(st.read) ? st.read : 'text';
        const t = await this.read({ mode, ref, max: st.max, links: st.links });
        this.stats.observations--;
        return { note: `${{ table: 'tabella', cards: 'schede', text: 'testo' }[mode]}:\n${t}` };
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
  async read({ mode = 'text', ref, selector, query, offset = 0, max, links }) {
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
      const r = await frame.evaluate(P.readCardsInPage, { ref, selector, offset, max: max || 20, links: !!links });
      if (r.err) throw new Error(r.err);
      const more = r.total - offset - r.rows.length;
      return `schede ${offset + 1}-${offset + r.rows.length} di ${r.total} (${r.sel})\n` + (r.common && r.common.length ? `in tutte: ${r.common.join(' · ')}\n` : '') + r.rows.join('\n') + (more > 0 ? `\n… altre ${more} (offset:${offset + r.rows.length})` : '');
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
