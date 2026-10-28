// Funzioni eseguite DENTRO la pagina. Playwright le serializza con toString(),
// quindi devono essere autosufficienti (nessun riferimento a variabili esterne).

/**
 * Raccoglie gli elementi interattivi visibili, assegna id stabili (ref) e
 * restituisce una struttura compatta. Nessuna modifica al DOM della pagina:
 * gli id vivono in window.__cb (WeakMap elemento -> id).
 */
export function collectInPage(opts) {
  const prefix = (opts && opts.prefix) || '';
  // numerazione globale per sessione: un documento nuovo riparte da start, cosi' un ref vecchio non puo' mai indicare un elemento diverso
  const S = (window.__cb = window.__cb || { n: (opts && opts.start) || 0, byEl: new WeakMap(), byId: new Map(), bySig: new Map(), seen: false });
  const fresh = !S.seen;
  S.seen = true;

  const STRICT =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=slider],[role=treeitem],[contenteditable=""],[contenteditable="true"]';
  const SEL = STRICT + ',[onclick],[tabindex]:not([tabindex="-1"])';
  const CONTAINER = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],summary';
  const REGION_SEL =
    'form,dialog,[role=dialog],[role=alertdialog],nav,[role=navigation],header,[role=banner],footer,[role=contentinfo],aside,[role=complementary],fieldset,table,[role=table],[role=grid],[role=menu],[role=toolbar],[role=tablist]';

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => {
    s = norm(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  // textContent e' molto piu' veloce di innerText; innerText solo se servono gli spazi tra blocchi annidati
  const txt = (e) => (!e ? '' : e.childElementCount === 0 ? e.textContent || '' : e.innerText || e.textContent || '');
  const hasCV = typeof Element.prototype.checkVisibility === 'function';

  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    if (hasCV) {
      if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
    } else {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return false;
    if (el.closest && el.closest('[aria-hidden="true"],[inert]')) return false;
    return true;
  };
  const hiddenInputOk = (el) =>
    el.tagName === 'INPUT' && /^(checkbox|radio|file)$/.test(el.type) && el.labels && el.labels[0] && isVisible(el.labels[0]);

  function roleOf(el) {
    const tag = el.tagName.toLowerCase();
    const r = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'input' && r === 'combobox') return 'combo';
    if (tag === 'input' && r === 'spinbutton') return 'num';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      const m = { checkbox: 'chk', radio: 'rad', password: 'pwd', file: 'file', submit: 'btn', button: 'btn', reset: 'btn', image: 'btn', date: 'date', 'datetime-local': 'date', time: 'date', month: 'date', week: 'date', number: 'num', range: 'range', color: 'color' };
      return m[t] || 'text';
    }
    if (tag === 'select') return 'sel';
    if (tag === 'textarea') return 'area';
    if (tag === 'button') return 'btn';
    if (tag === 'a') return r === 'button' ? 'btn' : 'link';
    if (tag === 'summary') return 'disc';
    const rm = { button: 'btn', link: 'link', checkbox: 'chk', radio: 'rad', tab: 'tab', menuitem: 'menu', menuitemcheckbox: 'menu', menuitemradio: 'menu', option: 'opt', switch: 'sw', combobox: 'combo', textbox: 'text', searchbox: 'text', slider: 'range', treeitem: 'tree' };
    if (rm[r]) return rm[r];
    if (el.isContentEditable) return 'edit';
    return 'clk';
  }

  function nameOf(el) {
    const tag = el.tagName.toLowerCase();
    let n = el.getAttribute('aria-label');
    if (!norm(n)) {
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        const root = el.getRootNode();
        n = lb
          .split(/\s+/)
          .map((i) => txt(root.getElementById ? root.getElementById(i) : document.getElementById(i)))
          .join(' ');
      }
    }
    if (!norm(n) && el.labels && el.labels.length) n = [...el.labels].map(txt).join(' ');
    if (!norm(n) && tag === 'input' && /^(submit|button|reset)$/.test(el.type)) n = el.value;
    if (!norm(n) && tag === 'input' && el.type === 'image') n = el.alt;
    if (!norm(n) && !/^(input|select|textarea)$/.test(tag)) n = txt(el);
    if (!norm(n) && el.querySelector) {
      const im = el.querySelector('img[alt]');
      if (im) n = im.getAttribute('alt');
    }
    if (!norm(n)) n = el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || '';
    if (!norm(n)) n = el.getAttribute('name') || el.id || '';
    return cut(norm(n).replace(/^[\s*:]+|[\s*:]+$/g, ''), 60).replace(/"/g, "'");
  }

  // regioni (form, dialog, nav, tabelle...) per raggruppare le righe
  const regionMap = new Map();
  const regions = [];
  const KIND = { form: 'form', dialog: 'dlg', nav: 'nav', header: 'hdr', footer: 'ftr', aside: 'aside', fieldset: 'fs', table: 'tbl' };
  const ROLEKIND = { dialog: 'dlg', alertdialog: 'dlg', navigation: 'nav', banner: 'hdr', contentinfo: 'ftr', complementary: 'aside', table: 'tbl', grid: 'tbl', menu: 'menu', toolbar: 'tools', tablist: 'tabs', search: 'search' };
  const LOW_SEL = 'nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[role=complementary]';
  function closestRegion(el) {
    let n = el;
    while (n) {
      const r = n.closest && n.closest(REGION_SEL);
      if (r) return r;
      const root = n.getRootNode && n.getRootNode();
      n = root && root.host ? root.host : null;
    }
    return null;
  }
  function regionIdx(el) {
    const r = closestRegion(el);
    if (!r) return -1;
    if (regionMap.has(r)) return regionMap.get(r);
    const tag = r.tagName.toLowerCase();
    const role = (r.getAttribute('role') || '').toLowerCase();
    const kind = ROLEKIND[role] || KIND[tag] || tag;
    const lb = r.getAttribute('aria-labelledby');
    let nm = r.getAttribute('aria-label') || (lb ? txt(document.getElementById(lb)) : '');
    if (!nm && tag === 'fieldset') nm = txt(r.querySelector('legend'));
    if (!nm && tag === 'form') nm = r.getAttribute('name') || r.id || '';
    if (!nm && (tag === 'dialog' || /dialog/.test(role))) nm = txt(r.querySelector('h1,h2,h3,[role=heading]'));
    const i = regions.length;
    const inMain = !!r.closest('main,[role=main]');
    regions.push({ kind, name: cut(nm, 30).replace(/"/g, "'"), low: !inMain && !!r.closest(LOW_SEL) });
    regionMap.set(r, i);
    return i;
  }

  const all = [];
  (function gather(root) {
    root.querySelectorAll(SEL).forEach((e) => all.push(e));
    root.querySelectorAll('*').forEach((e) => {
      if (e.shadowRoot) gather(e.shadowRoot);
    });
  })(document);
  const inc = new Set(all);

  // modale: se presente, mostriamo solo i suoi elementi
  let modalEl = null;
  let modalLabel = '';
  document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal="true"]').forEach((d) => {
    if (!isVisible(d)) return;
    let modal = false;
    try {
      modal = d.matches(':modal');
    } catch (e) {}
    if (!modal && d.getAttribute('aria-modal') === 'true') modal = true;
    if (!modal) {
      const st = getComputedStyle(d);
      const r = d.getBoundingClientRect();
      if (st.position === 'fixed' && r.width * r.height > 0.25 * innerWidth * innerHeight) modal = true;
    }
    if (modal) {
      modalEl = d;
      modalLabel = cut(d.getAttribute('aria-label') || txt(d.querySelector('h1,h2,h3,[role=heading]')), 40);
    }
  });

  // azioni con effetti: parole forti ovunque nel nome, oppure submit non di navigazione/ricerca
  const STRONG = /(invi[ao]\b|invio|inoltr|trasmett|protocoll|conferm|\bpaga|pagament|acquist|elimin|cancell|rimuov|pubblic|\bfirm[ao]\b|\bsalva|submit|\bsend\b|confirm|\bpay\b|purchase|\bbuy\b|checkout|delete|remove|publish|\bsign\b|\bsave\b|place order)/i;
  const ACC = /^(accett|accetto|accept|agree|acconsent)/i;
  const NAVW = /^(avanti|continua|prosegui|successiv|next|cerca|ricerca|search|filtra|applica|vai\b|go\b|mostra|visualizza|indietro|back|precedente|accedi|login|entra|ok\b)/i;
  const TERMS = /(accett|accetto|accept|agree|acconsent|consens|consent|dichiar|termini|condizioni|privacy|trattamento)/i;
  const isSearchForm = (f) => !!f && (f.getAttribute('role') === 'search' || !!f.querySelector('input[type=search]') || /cerca|ricerca|search|filtr/i.test(f.getAttribute('aria-label') || ''));

  // gruppi (righe di tabella, elementi di lista, card) per dare contesto ai nomi ripetuti
  const grpMap = new Map();
  const groups = [];
  const GROUP_STOP = /^(FORM|FIELDSET|MAIN|BODY|HTML|NAV|HEADER|FOOTER|TABLE|TBODY|UL|OL)$/;
  function groupOf(el) {
    let g = el.closest && el.closest('tr,[role=row],li,article');
    if (!g) {
      let a = el.parentElement;
      for (let k = 0; a && k < 4 && !GROUP_STOP.test(a.tagName); k++, a = a.parentElement) {
        if (a.querySelector('h2,h3,h4,h5,h6,[role=heading]') && a.querySelectorAll(SEL).length <= 6) {
          g = a;
          break;
        }
      }
    }
    if (!g || g === el) return -1;
    if (grpMap.has(g)) return grpMap.get(g);
    let label;
    if (g.tagName === 'TR' || g.getAttribute('role') === 'row') {
      const cells = [...g.querySelectorAll('td,th,[role=cell],[role=gridcell]')].filter((c) => !c.querySelector(SEL));
      label = cells.slice(0, 4).map((c) => norm(txt(c))).filter(Boolean).join(' · ');
    } else {
      const h = g.querySelector('h2,h3,h4,h5,h6,[role=heading]');
      label = h ? txt(h) : txt(g);
    }
    const i = groups.length;
    groups.push(cut(label, 70).replace(/"/g, "'"));
    grpMap.set(g, i);
    return i;
  }
  const CRED_AC = /(cc-(number|csc|exp|name)|one-time-code|current-password|new-password)/i;
  const CRED_ID = /(passw|pwd|cvv|cvc|iban|\botp\b|\bpin\b|card.?(number|no)|numero.?carta)/i;
  const PII_ID = /(codice.?fiscale|fiscal.?code|tax.?id|\bssn\b|passport|passaporto|carta.?d.?identit)/i;

  const occ = new Map();
  const newSig = new Map();
  const items = [];
  for (const el of all) {
    if (modalEl && !modalEl.contains(el)) continue;
    const tag = el.tagName.toLowerCase();
    const formCtl = /^(input|select|textarea)$/.test(tag);
    if (!(isVisible(el) || hiddenInputOk(el))) continue;
    const role = roleOf(el);
    if (!formCtl) {
      const p = el.parentElement && el.parentElement.closest(CONTAINER);
      if (p && p !== el && inc.has(p)) continue;
    }
    if (role === 'clk' && el.querySelector && el.querySelector(STRICT)) continue;
    const name = nameOf(el);
    if (role === 'clk' && (!name || (name.length > 50 && el.children.length > 3))) continue;

    const flags = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') flags.push('off');
    if (el.required || el.getAttribute('aria-required') === 'true') flags.push('req');
    if (el.readOnly) flags.push('ro');
    let inv = el.getAttribute('aria-invalid') === 'true';
    try {
      if (!inv && el.matches(':user-invalid')) inv = true;
    } catch (e) {}
    if (inv) flags.push('inv');
    const ex = el.getAttribute('aria-expanded');
    if (ex) flags.push(ex === 'true' ? 'exp' : 'col');
    const cur = el.getAttribute('aria-current');
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || (cur && cur !== 'false')) flags.push('on');

    let value = '';
    let checked;
    let options;
    if (role === 'chk' || role === 'rad' || role === 'sw') {
      checked = typeof el.checked === 'boolean' ? el.checked : el.getAttribute('aria-checked') === 'true';
    } else if (role === 'pwd') {
      value = el.value ? 'set' : '';
    } else if (role === 'sel') {
      value = [...el.selectedOptions].map((o) => cut(o.label || o.text, 40)).join(',');
      options = el.options.length <= 8 ? [...el.options].map((o) => cut(o.label || o.text, 40).replace(/\|/g, '/')) : el.options.length;
    } else if (role === 'file') {
      value = el.files && el.files.length ? el.files.length + ' file' : '';
    } else if (formCtl) {
      value = cut(el.value, 30);
    } else if (role === 'edit') {
      value = cut(txt(el), 30);
    }

    // sensibilita: x = credenziali/pagamento (mai compilabile), p = identificativo, c = azione che richiede conferma
    const ac = el.getAttribute('autocomplete') || '';
    const idn = [el.getAttribute('name'), el.id, ac, name].join(' ');
    let s = '';
    if (formCtl || role === 'edit' || role === 'combo') {
      if (role === 'pwd' || CRED_AC.test(ac) || CRED_ID.test(idn)) s = 'x';
      else if (PII_ID.test(idn)) s = 'p';
    }
    if (/^(btn|link|clk|menu)$/.test(role)) {
      const isSubmit = (tag === 'button' || tag === 'input') && el.type === 'submit' && !!el.form;
      if (STRONG.test(name) || ACC.test(name)) s = 'c';
      else if (isSubmit && !NAVW.test(name) && !isSearchForm(el.form)) s = 'c';
    }
    if ((role === 'chk' || role === 'sw') && TERMS.test(name)) s = 'c';

    const grp = groupOf(el);
    const ctx = grp >= 0 ? groups[grp] : '';
    const reg = regionIdx(el);
    const regLabel = reg >= 0 ? regions[reg].kind + regions[reg].name : '';

    // id stabili: stesso elemento -> stesso id; se il nodo viene ri-renderizzato, riuso l'id per firma
    const sigBase = role + '|' + name + '|' + regLabel + '|' + ctx;
    const k = (occ.get(sigBase) || 0) + 1;
    occ.set(sigBase, k);
    const sig = sigBase + '#' + k;
    let id = S.byEl.get(el);
    if (!id) {
      const old = S.bySig.get(sig);
      if (old) {
        const oe = S.byId.get(old);
        if (!oe || !oe.isConnected) id = old;
      }
      if (!id) id = prefix + 'e' + ++S.n;
      S.byEl.set(el, id);
    }
    S.byId.set(id, el);
    newSig.set(sig, id);

    items.push({
      id, role, name, value, checked, flags, s, reg, options, ctx, grp,
      href: role === 'link' && typeof el.href === 'string' ? el.href : '',
      inForm: !!el.form,
    });
  }
  S.bySig = newSig;
  for (const [id, e] of S.byId) if (!e.isConnected) S.byId.delete(id);

  // messaggi di errore/avviso visibili
  const alerts = [];
  const seenA = new Set();
  document
    .querySelectorAll('[role=alert],[role=status],[aria-live=assertive],.alert-danger,.alert-error,.invalid-feedback,.field-error,.form-error,.error-message,.text-danger,.has-error .help-block,.msg-error,.errorlist li')
    .forEach((e) => {
      if (!isVisible(e)) return;
      const t = cut(txt(e), 140);
      if (t && !seenA.has(t)) {
        seenA.add(t);
        alerts.push(t);
      }
    });
  alerts.length = Math.min(alerts.length, 5);

  const capEls = [...document.querySelectorAll('.g-recaptcha,.h-captcha,.cf-turnstile,iframe[src*="hcaptcha" i],iframe[src*="turnstile" i],iframe[src*="recaptcha" i],#challenge-running,#challenge-stage')].filter(
    (e) => !(e.closest && e.closest('.grecaptcha-badge')) && isVisible(e)
  );
  const login = [...document.querySelectorAll('input[type=password]')].some(isVisible);
  const h1 = document.querySelector('h1');

  const res = {
    items, regions, alerts, fresh, ngroups: groups.length, n: S.n,
    modal: modalEl ? modalLabel || 'dialog' : '',
    captcha: capEls.length > 0,
    login,
    total: all.length,
    mut: window.__cbMut || 0,
    meta: { title: cut(document.title, 80), h1: cut(txt(h1), 80), y: Math.round(scrollY), h: document.documentElement.scrollHeight, vh: innerHeight, vw: innerWidth },
  };
  // JSON e' molto piu' veloce da trasferire del serializzatore di Playwright su liste grandi
  return opts && opts.json ? JSON.stringify(res) : res;
}

/** Rifiuta i cookie non essenziali (opzione piu' protettiva della privacy). */
export function dismissCookiesInPage() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && st.display !== 'none' && st.visibility !== 'hidden';
  };
  const REJ = /^(rifiuta( tutt[oi])?|rifiuto|solo (i )?(cookie )?(necessari|tecnici)|continua senza accettare|nega|reject( all)?|decline( all)?|deny( all)?|only (necessary|essential)( cookies)?|necessary only|refuse|use necessary cookies only)/i;
  const direct = ['#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline', '.iubenda-cs-reject-btn', '.cc-deny', 'button[data-cookiefirst-action="reject"]', '.fc-cta-do-not-consent', '#cookie-reject', '.cmplz-deny'];
  for (const sel of direct) {
    const el = document.querySelector(sel);
    if (el && vis(el)) {
      el.click();
      return sel;
    }
  }
  const boxes = document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=gdpr i],[class*=gdpr i],[role=dialog]');
  for (const c of boxes) {
    if (!vis(c)) continue;
    for (const b of c.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')) {
      if (!vis(b)) continue;
      if (REJ.test(norm(b.innerText || b.textContent || b.value))) {
        b.click();
        return norm(b.innerText || b.textContent || b.value);
      }
    }
  }
  return '';
}

/** Testo nuovo apparso dopo le azioni (messaggi di esito non marcati come alert). */
export function addedTextInPage(max) {
  const arr = (window.__cbAdded || []).slice(-300);
  window.__cbAdded = [];
  const els = new Set();
  for (const n of arr) {
    const e = n && (n.nodeType === 1 ? n : n.parentElement);
    if (e && e.isConnected && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HTML|BODY|HEAD)$/.test(e.tagName)) els.add(e);
  }
  const list = [...els].filter((e) => ![...els].some((o) => o !== e && o.contains(e)));
  const out = [];
  let total = 0;
  for (const e of list) {
    if (e.checkVisibility && !e.checkVisibility()) continue;
    if (e.closest('[aria-hidden="true"],[role=listbox],[role=option]')) continue;
    if (e.matches('input,select,textarea,option,button,a')) continue;
    const t = (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    out.push(t.length > 160 ? t.slice(0, 159) + '…' : t);
    total += Math.min(t.length, 160);
    if (out.length >= max || total > 480) break;
  }
  return out;
}

export function readTextInPage(a) {
  const reg = window.__cb;
  const el = a.ref ? reg && reg.byId.get(a.ref) : a.selector ? document.querySelector(a.selector) : document.querySelector('main') || document.body;
  if (!el) return { err: 'elemento non trovato' };
  const t = (el.innerText || el.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { total: t.length, text: t.slice(a.offset, a.offset + a.maxChars) };
}

export function readTableInPage(a) {
  const reg = window.__cb;
  let el = a.ref ? reg && reg.byId.get(a.ref) : a.selector ? document.querySelector(a.selector) : document.querySelector('table,[role=grid],[role=table]');
  if (!el) return { err: 'tabella non trovata' };
  if (!/^(table)$/i.test(el.tagName) && !/^(grid|table)$/.test(el.getAttribute('role') || '')) el = el.querySelector('table,[role=grid],[role=table]') || el;
  const cut = (s) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > 60 ? s.slice(0, 59) + '…' : s;
  };
  const rows = [...el.querySelectorAll('tr,[role=row]')].map((r) => [...r.querySelectorAll('th,td,[role=cell],[role=columnheader],[role=gridcell]')].map((c) => cut(c.innerText || c.textContent)).join('\t'));
  return { total: rows.length, rows: rows.slice(a.offset, a.offset + a.maxRows) };
}

export function findTextInPage(a) {
  const t = (document.body.innerText || '').split('\n');
  const q = a.query.toLowerCase();
  const hits = [];
  for (const line of t) {
    const l = line.replace(/\s+/g, ' ').trim();
    if (l && l.toLowerCase().includes(q)) {
      hits.push(l.length > 160 ? l.slice(0, 159) + '…' : l);
      if (hits.length >= a.max) break;
    }
  }
  return { hits };
}

export function describeInPage(id) {
  const reg = window.__cb;
  const el = reg && reg.byId.get(id);
  if (!el) return { err: 'ref scaduto' };
  const cut = (s, n) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const o = { tag: el.tagName.toLowerCase(), type: el.type || '', text: cut(el.innerText || el.textContent, 300) };
  if (el.tagName === 'SELECT') {
    o.options = [...el.options].slice(0, 150).map((x) => cut(x.label || x.text, 40));
    o.selected = [...el.selectedOptions].map((x) => cut(x.label || x.text, 40));
  } else if ('value' in el && el.type !== 'password') o.value = cut(el.value, 300);
  if (el.href && typeof el.href === 'string') o.href = el.href;
  return o;
}
