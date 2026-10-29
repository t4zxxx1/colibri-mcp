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
  // confronto multilingue: minuscole e senza accenti (contraseña -> contrasena, bestätigen -> bestatigen)
  const fold = (s) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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

  // id cercato nella stessa radice (shadow DOM) e poi nel documento: alcuni framework (Salesforce Lightning/LWC,
  // Locker) vietano getElementById o querySelector sulle ShadowRoot e lanciano un'eccezione
  function byIdNear(el, id) {
    let root = null;
    try {
      root = el.getRootNode();
    } catch {}
    if (root && root !== document) {
      try {
        if (root.getElementById) return root.getElementById(id);
      } catch {}
      try {
        return root.querySelector('#' + CSS.escape(id));
      } catch {}
    }
    try {
      return document.getElementById(id);
    } catch {
      return null;
    }
  }

  function nameOf(el) {
    const tag = el.tagName.toLowerCase();
    let n = el.getAttribute('aria-label');
    if (!norm(n)) {
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        n = lb
          .split(/\s+/)
          .map((i) => txt(byIdNear(el, i)))
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
    if (!norm(n) && el.querySelector) n = txt(el.querySelector('svg title')) || '';
    if (!norm(n) && !/^(input|select|textarea)$/.test(tag)) n = iconName(el);
    if (!norm(n)) n = el.getAttribute('name') || el.id || '';
    return cut(norm(n).replace(/^[\s*:]+|[\s*:]+$/g, ''), 60).replace(/"/g, "'");
  }
  // etichetta completa (non troncata) per l'abbinamento dei parametri
  function nameFull(el) {
    const n = el.getAttribute('aria-label') || (el.labels && el.labels.length ? [...el.labels].map(txt).join(' ') : '') || el.getAttribute('title') || '';
    return norm(n).replace(/^[\s*:]+|[\s*:]+$/g, '').replace(/"/g, "'");
  }

  // pulsanti con sola icona: nome dedotto dalle classi (marcato con ~ perche' e' una stima)
  const ICONS = [['trash', 'elimina'], ['delete', 'elimina'], ['bin', 'elimina'], ['remove', 'rimuovi'], ['close', 'chiudi'], ['times', 'chiudi'], ['xmark', 'chiudi'],
    ['edit', 'modifica'], ['pencil', 'modifica'], ['search', 'cerca'], ['magnif', 'cerca'], ['download', 'scarica'], ['upload', 'carica'], ['print', 'stampa'],
    ['plus', 'aggiungi'], ['add', 'aggiungi'], ['save', 'salva'], ['floppy', 'salva'], ['eye', 'visualizza'], ['view', 'visualizza'], ['settings', 'impostazioni'],
    ['gear', 'impostazioni'], ['cog', 'impostazioni'], ['bars', 'menu'], ['hamburger', 'menu'], ['menu', 'menu'], ['user', 'utente'], ['info', 'info'],
    ['help', 'aiuto'], ['question', 'aiuto'], ['home', 'home'], ['arrow-left', 'indietro'], ['chevron-left', 'indietro'], ['arrow-right', 'avanti'],
    ['chevron-right', 'avanti'], ['paper-plane', 'invia'], ['send', 'invia'], ['refresh', 'aggiorna'], ['sync', 'aggiorna'], ['filter', 'filtra'],
    ['calendar', 'calendario'], ['copy', 'copia'], ['share', 'condividi'], ['logout', 'esci'], ['sign-out', 'esci'], ['check', 'conferma']];
  function iconName(el) {
    const parts = [el, ...(el.querySelectorAll ? el.querySelectorAll('svg,i,span,use,img') : [])].slice(0, 6);
    const cls = parts.map((e) => [e.getAttribute('class'), e.getAttribute('href'), e.getAttribute('xlink:href'), e.getAttribute('data-icon'), e.getAttribute('src')].join(' ')).join(' ').toLowerCase();
    for (const [k, v] of ICONS) if (new RegExp('(^|[^a-z])' + k).test(cls)) return '~' + v;
    return '';
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
  const seen = new Set();
  (function gather(root) {
    let found, kids;
    try {
      found = root.querySelectorAll(SEL);
      kids = root.querySelectorAll('*');
    } catch {
      return; // ShadowRoot con metodi vietati (Locker/LWC): si salta solo quel ramo
    }
    // con lo shadow DOM "sintetico" (LWC) lo stesso nodo puo' comparire sia nel documento sia nella ShadowRoot
    found.forEach((e) => {
      if (!seen.has(e)) {
        seen.add(e);
        all.push(e);
      }
    });
    kids.forEach((e) => {
      let sr = null;
      try {
        sr = e.shadowRoot;
      } catch {}
      if (sr) gather(sr);
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
  // regole applicate a testo senza accenti: it, en, fr, es, de, pt
  const STRONG = /(invi[ao]\b|invio|inoltr|trasmett|protocoll|conferm|\bpaga|pagament|acquist|elimin|cancell|rimuov|pubblic|\bfirm[ao]\b|\bsalva|approv|autorizz|submit|\bsend\b|confirm|\bpay\b|purchase|\bbuy\b|checkout|delete|remove|publish|\bsign\b|\bsave\b|place order|\btrash\b|envoyer|soumettre|confirmer|valider|supprimer|payer|acheter|commander|enregistrer|publier|signer|enviar|confirmar|eliminar|borrar|pagar|comprar|guardar|publicar|firmar|excluir|apagar|assinar|absenden|\bsenden|bestatigen|loschen|entfernen|bezahlen|zahlungspflichtig|kaufen|bestellen|speichern|veroffentlichen|unterschreiben|einreichen)/;
  const ACC = /^(accett|accept|agree|acconsent|j.?accepte|accepter|acepto|aceptar|aceito|aceitar|akzeptier|zustimm|einverstanden|ich stimme)/;
  const NAVW = /^(avanti|continua|prosegui|successiv|next|cerca|ricerca|search|filtra|applica|vai\b|go\b|mostra|visualizza|indietro|back|precedente|accedi|login|log in|sign in|entra|ok\b|suivant|continuer|rechercher|chercher|retour|precedent|connexion|se connecter|siguiente|continuar|buscar|atras|anterior|iniciar sesion|entrar|proximo|seguinte|pesquisar|voltar|weiter|fortfahren|suchen|zuruck|anmelden|einloggen)/;
  const LOGIN = /^(sign in|log in|signin|login|accedi|anmelden|se connecter|iniciar sesion|entrar)\b/;
  const TERMS = /(accett|accept|agree|acconsent|consens|consent|dichiar|termini|condizioni|privacy|trattamento|conditions|declare|acepto|terminos|condiciones|consentimiento|datenschutz|einwillig|zustimm|akzeptier|bedingungen|aceito|termos|declaro|je declare|ich bestatige|erklare|rgpd|gdpr|dsgvo)/;
  const isSearchForm = (f) => !!f && (f.getAttribute('role') === 'search' || !!f.querySelector('input[type=search]') || /cerca|ricerca|search|filtr|recherch|buscar|such|pesquis/.test(fold(f.getAttribute('aria-label'))));

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
  const CRED_AC = /(cc-(number|csc|exp|name)|one-time-code|current-password|new-password)/;
  const CRED_ID = /(passw|pwd|kennwort|contrasena|mot.?de.?passe|senha|\bclave\b|cvv|cvc|\bcsc\b|prufziffer|iban|\botp\b|\bpin\b|\btan\b|card.?(number|no)|numero.?carta|numero.?de.?tarjeta|numero.?de.?carte|kartennummer|numero.?do.?cartao|codice.?di.?sicurezza|security.?code)/;
  const PII_ID = /(codice.?fiscale|fiscal.?code|tax.?id|\bssn\b|passport|passaporto|carta.?d.?identit|\bdni\b|\bnie\b|\bnif\b|\bcpf\b|steuer.?id|steuernummer|personalausweis|reisepass|pasaporte|passeport|carte.?d.?identite|numero.?fiscal|securite.?sociale|sozialversicherung)/;
  // etichetta di un gruppo di radio: testo che precede la prima opzione del gruppo (es. "Ruolo *") o la legenda
  function radioGroupLabel(el) {
    const fs = el.closest && el.closest('fieldset,[role=radiogroup]');
    if (fs && fs.getAttribute('role') === 'radiogroup') return cut(fs.getAttribute('aria-label') || '', 40);
    let n = el.closest('label') || el;
    for (let k = 0; n && k < 6; k++) {
      n = n.previousElementSibling;
      if (!n) break;
      if (n.matches('label') && n.querySelector('input[type=radio]')) continue;
      if (n.matches('input[type=radio]')) continue;
      const t = norm(n.textContent);
      if (t && !n.querySelector('input,select,textarea')) return cut(t.replace(/[\s*:]+$/, ''), 40);
    }
    return fs ? cut(txt(fs.querySelector('legend')), 40) : '';
  }
  // elemento coperto da un overlay fisso (banner, barra, maschera): segnalato come "cop"
  const vw = innerWidth;
  const vh = innerHeight;
  function deepHit(x, y) {
    let h = document.elementFromPoint(x, y);
    while (h && h.shadowRoot) {
      const inner = h.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === h) break;
      h = inner;
    }
    return h;
  }
  function covered(el, r) {
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw || r.width < 2 || r.height < 2) return false;
    const h = deepHit(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
    if (!h || h === el || el.contains(h) || h.contains(el)) return false;
    if (h.tagName === 'LABEL' && h.control === el) return false;
    for (let a = h, k = 0; a && k < 8; a = a.parentElement, k++) {
      const pos = getComputedStyle(a).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  }

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
    if (!formCtl || isVisible(el)) {
      const r = el.getBoundingClientRect();
      if (covered(el, r)) flags.push('cop');
    }
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
    const fname = fold(name);
    const idn = fold([el.getAttribute('name'), el.id, ac, name].join(' '));
    let s = '';
    if (formCtl || role === 'edit' || role === 'combo') {
      if (role === 'pwd' || CRED_AC.test(fold(ac)) || CRED_ID.test(idn)) s = 'x';
      else if (PII_ID.test(idn)) s = 'p';
    }
    if (/^(btn|link|clk|menu)$/.test(role)) {
      const isSubmit = (tag === 'button' || tag === 'input') && el.type === 'submit' && !!el.form;
      if ((STRONG.test(fname) && !LOGIN.test(fname)) || ACC.test(fname)) s = 'c';
      else if (isSubmit && !NAVW.test(fname) && !isSearchForm(el.form)) s = 'c';
      // apre un menu/finestra o modifica un contatore locale: nessun invio, niente conferma
      if (s === 'c' && !isSubmit && !ACC.test(fname)) {
        const opener = (el.getAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') || el.hasAttribute('aria-expanded');
        const stepper = /^(rimuov|togli|remove|entfernen|quitar|retirer)/.test(fname) && /(passegger|passenger|viaggiator|travel+er|adult|bambin|child|infant|neonat|ospit|guest|person|camer|room|quantit|quantity|passagier|reisend|gast|pasajer|voyageur|bagagl|luggage|bag)/.test(fname);
        if (opener || stepper) s = '';
      }
    }
    if ((role === 'chk' || role === 'sw') && TERMS.test(fname)) s = 'c';

    // dati per l'abbinamento dei parametri (non mostrati a Claude)
    let gx;
    if (formCtl || role === 'edit' || role === 'combo') {
      const fs = el.closest && el.closest('fieldset');
      // testo vicino solo per i campi senza etichetta (altrimenti rischia di essere l'etichetta del campo precedente)
      let near = '';
      const labelled = (el.labels && el.labels.length) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!labelled) for (let p = el.previousSibling, k = 0; p && k < 3 && !near; p = p.previousSibling, k++) if (p.nodeType === 3 || (p.nodeType === 1 && !p.matches(SEL + ',label'))) near = norm(p.textContent);
      gx = {
        full: name.endsWith('…') ? cut(nameFull(el), 200) : undefined,
        ph: el.getAttribute('placeholder') || '',
        nm: el.getAttribute('name') || el.id || '',
        ty: (el.getAttribute('type') || tag).toLowerCase(),
        ac,
        near: cut(near, 60),
        leg: fs ? cut(txt(fs.querySelector('legend')), 40) : '',
        opts: tag === 'select' ? [...el.options].slice(0, 400).map((o) => cut(o.label || o.text, 60)) : undefined,
        grpName: role === 'rad' ? el.name || '' : undefined,
        glab: role === 'rad' ? radioGroupLabel(el) : undefined,
      };
    }

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
      id, role, name, value, checked, flags, s, reg, options, ctx, grp, gx,
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
  const REJ = /^(rifiuta( tutt[oi])?|rifiuto|solo (i )?(cookie )?(necessari|tecnici)|continua senza accettare|nega|reject( all)?|decline( all)?|deny( all)?|only (necessary|essential)( cookies)?|necessary only|refuse|use necessary cookies only|tout refuser|refuser( tout)?|continuer sans accepter|rechazar( todo| todas)?|solo (las )?necesarias|alle ablehnen|ablehnen|nur (notwendige|essenzielle|erforderliche)|rejeitar( todos)?|recusar( todos)?|apenas necessarios)/i;
  const fold = (s) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
      if (REJ.test(fold(b.innerText || b.textContent || b.value))) {
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
  const r = el.getBoundingClientRect();
  const f = (v, d) => Math.round((v / d) * 1000) / 1000;
  o.box = { l: f(r.left, innerWidth), t: f(r.top, innerHeight), r: f(r.right, innerWidth), b: f(r.bottom, innerHeight), in: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth };
  return o;
}

/**
 * Risultati ripetuti (treni, voli, prodotti, offerte) come righe compatte: una riga per scheda con i testi
 * visibili separati da " | ". Le schede si trovano da sole (gruppo di fratelli simili con piu' testo) oppure con selector.
 */
export function readCardsInPage(a) {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const root = (a.ref && window.__cb && window.__cb.byId.get(a.ref)) || document.body;
  if (!root) return { err: 'pagina vuota' };
  const len = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim().length;
  let cards = [];
  let how = '';
  if (a.selector) {
    try {
      cards = [...root.querySelectorAll(a.selector)].filter(vis);
    } catch (e) {
      return { err: 'selector non valido' };
    }
    how = a.selector;
  } else {
    const sig = (e) => e.tagName + '.' + [...e.classList].map((c) => c.replace(/[-_]?\d+/g, '')).filter((c) => !/active|selected|open|odd|even|first|last|hover|focus/i.test(c)).sort().slice(0, 3).join('.');
    let best = null;
    const all = [root, ...root.querySelectorAll('*')].slice(0, 8000);
    for (const p of all) {
      if (p.children.length < 3 || /^(SELECT|DATALIST|HEAD|SCRIPT|STYLE|SVG)$/i.test(p.tagName)) continue;
      if (p.closest('nav,header,footer,[role=navigation],[role=banner],[role=contentinfo]')) continue;
      const groups = new Map();
      for (const c of p.children) {
        const k = sig(c);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      }
      for (const g of groups.values()) {
        if (g.length < 3) continue;
        const shown = g.filter(vis);
        if (shown.length < 3) continue;
        const lens = shown.map(len);
        const avg = lens.reduce((x, y) => x + y, 0) / lens.length;
        // le schede hanno piu' informazioni (orari, prezzi): servono almeno ~3 pezzi di testo
        const parts = shown.slice(0, 5).map((c) => [...c.querySelectorAll('*')].filter((x) => !x.children.length && (x.textContent || '').trim()).length);
        const avgParts = parts.reduce((x, y) => x + y, 0) / parts.length;
        if (avg < 15 || avgParts < 2.5) continue;
        const score = shown.length * Math.min(avg, 250) * Math.min(avgParts, 8);
        if (!best || score > best.score) best = { score, els: shown };
      }
    }
    if (best) {
      cards = best.els;
      const f = cards[0];
      how = f.tagName.toLowerCase() + (f.classList.length ? '.' + [...f.classList].slice(0, 2).join('.') : '');
    }
  }
  if (!cards.length) return { err: 'nessun gruppo di schede ripetute: usa selector, oppure mode "table"/"text"' };
  const rows = cards.map((c) => {
    const parts = [];
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (!t || t.length < 1) continue;
      const pe = n.parentElement;
      if (!pe || pe.closest('[aria-hidden=true],script,style,noscript,svg') || !vis(pe)) continue;
      const v = t.length > 60 ? t.slice(0, 59) + '…' : t;
      if (parts[parts.length - 1] !== v && !parts.includes(v)) parts.push(v);
    }
    const s = parts.join(' | ');
    return s.length > 320 ? s.slice(0, 319) + '…' : s;
  });
  const off = a.offset || 0;
  const max = a.max || 20;
  return { total: rows.length, sel: how, rows: rows.slice(off, off + max) };
}

/** Elemento sotto un punto (coordinate CSS del viewport): ref noto, tag, testo e sensibilita'. */
export function hitTestInPage(a) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fold = (s) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let h = document.elementFromPoint(a.x, a.y);
  while (h && h.shadowRoot) {
    const inner = h.shadowRoot.elementFromPoint(a.x, a.y);
    if (!inner || inner === h) break;
    h = inner;
  }
  if (!h) return { tag: '' };
  const S = window.__cb;
  let id = '';
  for (let e = h, k = 0; e && k < 12; k++) {
    const v = S && S.byEl.get(e);
    if (v) {
      id = v;
      break;
    }
    e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
  }
  const text = norm(h.innerText || h.textContent || h.getAttribute('aria-label') || h.getAttribute('title') || '').slice(0, 60);
  const STRONG = /(invi[ao]\b|invio|inoltr|trasmett|protocoll|conferm|\bpaga|pagament|acquist|elimin|cancell|rimuov|pubblic|\bsalva|submit|\bsend\b|confirm|\bpay\b|purchase|\bbuy\b|checkout|delete|remove|publish|\bsave\b|envoyer|confirmer|valider|supprimer|payer|acheter|enviar|confirmar|eliminar|pagar|comprar|absenden|bestatigen|loschen|bezahlen|kaufen)/;
  return { id, tag: h.tagName.toLowerCase(), text, s: STRONG.test(fold(text)) ? 'c' : '' };
}

/** Disegna sopra la pagina le etichette dei ref visibili (stile "set of marks"); restituisce quante. */
export function labelsInPage() {
  const S = window.__cb;
  if (!S) return 0;
  document.getElementById('__cb_labels')?.remove();
  const box = document.createElement('div');
  box.id = '__cb_labels';
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  let n = 0;
  for (const [id, el] of S.byId) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const o = document.createElement('div');
    o.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px solid #e8a33d;`;
    const t = document.createElement('div');
    t.textContent = id;
    t.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top - 14)}px;font:bold 11px/13px monospace;background:#e8a33d;color:#000;padding:0 2px;`;
    box.append(o, t);
    n++;
  }
  document.documentElement.append(box);
  return n;
}

export function clearLabelsInPage() {
  document.getElementById('__cb_labels')?.remove();
}

/** Coppie etichetta-valore e righe di testo visibili, per l'estrazione tipizzata (il confronto lo fa il motore). */
export function pairsInPage(a) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);
  const root = (a && a.scope && document.querySelector(a.scope)) || document.querySelector('main,[role=main]') || document.body;
  const vis = (e) => !e.checkVisibility || e.checkVisibility({ visibilityProperty: true });
  const pairs = [];
  root.querySelectorAll('dt').forEach((dt) => {
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD' && vis(dt)) pairs.push({ l: norm(dt.textContent), v: cut(norm(dd.innerText || dd.textContent), 200), k: 'dl' });
  });
  root.querySelectorAll('tr').forEach((tr) => {
    const c = tr.querySelectorAll('th,td');
    if (c.length === 2 && vis(tr)) pairs.push({ l: norm(c[0].textContent), v: cut(norm(c[1].innerText || c[1].textContent), 200), k: 'tr' });
  });
  root.querySelectorAll('label').forEach((lb) => {
    const c = lb.control;
    if (c && 'value' in c && c.type !== 'password' && vis(lb)) pairs.push({ l: norm(lb.textContent), v: cut(String(c.value), 200), k: 'form' });
  });
  const lines = norm(root.innerText || '') ? (root.innerText || '').split('\n').map(norm).filter(Boolean).slice(0, 400).map((l) => cut(l, 240)) : [];
  // tabelle con intestazione: righe come oggetti
  const tables = [...root.querySelectorAll('table')].filter(vis).slice(0, 5).map((t) => {
    const head = [...t.querySelectorAll('thead th, tr:first-child th')].map((h) => norm(h.textContent));
    const rows = [...t.querySelectorAll('tbody tr, tr')].filter((r) => r.querySelector('td')).slice(0, 300).map((r) => [...r.querySelectorAll('td,th')].map((c) => cut(norm(c.innerText || c.textContent), 120)));
    return { head, rows };
  });
  return JSON.stringify({ pairs: pairs.slice(0, 300), lines, tables });
}

/**
 * Verifiche anti-bot (CAPTCHA, pagine "Just a moment", bot manager).
 * block: la pagina e' bloccata finche' non si supera la verifica (muro a pagina intera o puzzle aperto).
 * Altrimenti e' un riquadro dentro un modulo: solved dice se e' gia' stato risolto.
 */
export function challengeInPage() {
  const onScreen = (e) => {
    if (!e || !e.getBoundingClientRect) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.right < 0 || r.top > innerHeight + 2000) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05;
  };
  const any = (sel) => [...document.querySelectorAll(sel)].find((e) => onScreen(e) && !(e.closest && e.closest('.grecaptcha-badge')));
  const filled = (sel) => [...document.querySelectorAll(sel)].some((e) => (e.value || '').length > 8);
  const title = document.title || '';
  const body = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 4000);
  const WALL =
    /(just a moment|un momento\b|one more step|attention required|verify(ing)? (that )?you are (a )?human|verify(ing)? you'?re (a )?human|checking (your browser|if the site connection is secure)|verifica(re)? (di essere|che sei|che tu sia) (un )?(essere )?uman|controllo del browser|i'?m not a robot|non sono un robot|are you a (robot|human)|press (and|&) hold|tieni premuto|unusual traffic|traffico insolito|prove you'?re (not a robot|human)|access to this page has been denied|vérification de sécurité|êtes-vous un robot|verifique que (é|es) humano|sind sie ein mensch|bestätigen sie, dass sie ein mensch sind)/i;
  const kindOf = (src) =>
    /challenges\.cloudflare|turnstile/i.test(src) ? 'Turnstile' : /hcaptcha/i.test(src) ? 'hCaptcha' : /recaptcha/i.test(src) ? 'reCAPTCHA' : 'CAPTCHA';

  // 1) muri a pagina intera
  if ((window._cf_chl_opt && (WALL.test(title + ' ' + body) || body.length < 150)) || any('#challenge-form,#challenge-running,#challenge-stage,#cf-challenge-running,.cf-browser-verification,#cf-please-wait,#cf-wrapper #challenge-body-text'))
    return { kind: 'Cloudflare', block: true };
  if (any('iframe[src*="captcha-delivery.com"],iframe[src*="geo.captcha-delivery"]')) return { kind: 'DataDome', block: true };
  if (any('#px-captcha,#px-captcha-wrapper,iframe[src*="px-cloud.net"],iframe[src*="perimeterx"]')) return { kind: 'PerimeterX', block: true };
  if (any('awswaf-captcha,#captcha-container[data-awswaf],#aws-waf-token') || window.AwsWafCaptcha) return { kind: 'AWS WAF', block: true };
  if (any('iframe[src*="arkoselabs"],iframe[src*="funcaptcha"],#FunCaptcha,#arkose,#arkoseFrame')) return { kind: 'Arkose', block: true };
  if (any('.geetest_panel_box,.geetest_box,.geetest_popup_wrap')) return { kind: 'GeeTest', block: true };
  // puzzle a immagini aperto (reCAPTCHA / hCaptcha)
  const puzzle = any('iframe[src*="recaptcha/api2/bframe"],iframe[src*="recaptcha/enterprise/bframe"],iframe[src*="hcaptcha"][src*="frame=challenge"]');
  if (puzzle && puzzle.getBoundingClientRect().height > 120) return { kind: kindOf(puzzle.src), block: true };
  const shortPage = body.length < 900 && document.querySelectorAll('input:not([type=hidden]),select,textarea').length < 3 && document.links.length < 8;
  if (WALL.test(title) ? body.length < 2500 || shortPage : shortPage && WALL.test(body)) return { kind: 'anti-bot', block: true };

  // 2) riquadri dentro un modulo
  const RESP = '[name="g-recaptcha-response"],[name="h-captcha-response"],[name="cf-turnstile-response"],[name="frc-captcha-solution"],[name="mtcaptcha-verifiedtoken"]';
  const widget = any(
    '.g-recaptcha:not([data-size=invisible]),.h-captcha:not([data-size=invisible]),.cf-turnstile,.frc-captcha,.mtcaptcha,' +
      'iframe[src*="recaptcha"][src*="anchor"]:not([src*="size=invisible"]),iframe[src*="hcaptcha"][src*="frame=checkbox"],iframe[src*="challenges.cloudflare.com"]'
  );
  if (widget) {
    const cls = widget.className && typeof widget.className === 'string' ? widget.className : '';
    const kind = /frc-/.test(cls) ? 'Friendly Captcha' : /mtcaptcha/.test(cls) ? 'MTCaptcha' : kindOf((widget.src || '') + ' ' + cls.replace('g-recaptcha', 'recaptcha').replace('h-captcha', 'hcaptcha').replace('cf-turnstile', 'turnstile'));
    return { kind, block: false, solved: filled(RESP) };
  }
  // CAPTCHA a immagine classico: immagine + campo dove scrivere il codice
  const img = any('img[src*="captcha" i],img[id*="captcha" i],img[alt*="captcha" i],img[class*="captcha" i],canvas[id*="captcha" i]');
  if (img) {
    const inp = [...document.querySelectorAll('input[name*="captcha" i],input[id*="captcha" i],input[placeholder*="captcha" i],input[aria-label*="captcha" i]')].find(onScreen);
    return { kind: 'CAPTCHA a immagine', block: false, solved: !!(inp && inp.value.trim().length >= 3) };
  }
  return null;
}

/** Barra in cima alla pagina che avvisa l'utente: Colibri e' in pausa finche' non completa la verifica. */
export function humanBannerInPage(a) {
  const old = document.getElementById('__colibri_human');
  if (!a || !a.show) {
    if (old) old.remove();
    return;
  }
  if (old) return;
  const it = /^it/i.test(navigator.language || '');
  const d = document.createElement('div');
  d.id = '__colibri_human';
  d.setAttribute('aria-hidden', 'true');
  d.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none;padding:10px 16px;font:600 15px/1.35 system-ui,sans-serif;' +
    'color:#04121a;background:linear-gradient(90deg,#67e8f9,#a78bfa);box-shadow:0 2px 12px rgba(0,0,0,.35);text-align:center';
  d.textContent = it
    ? `🐦 Colibri è in pausa: completa la verifica (${a.kind}) qui sotto, poi riprendo da solo.`
    : `🐦 Colibri is paused: complete the check (${a.kind}) below, then I'll continue on my own.`;
  (document.body || document.documentElement).appendChild(d);
}

/** Il modulo dell'elemento (o di quello attivo) contiene un CAPTCHA? */
export function captchaFormInPage(el) {
  const a = el || document.activeElement;
  const f = a && (a.form || (a.closest && a.closest('form')));
  if (!f) return false;
  return !!f.querySelector(
    '.g-recaptcha,.h-captcha,.cf-turnstile,.frc-captcha,.mtcaptcha,iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],' +
      '[name="g-recaptcha-response"],[name="h-captcha-response"],[name="cf-turnstile-response"],input[name*="captcha" i],img[src*="captcha" i]'
  );
}
