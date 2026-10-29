// Motore decisionale locale in stile "System One" (Jev): domande tipizzate con probabilita' e confidenza.
// Nessun modello esterno: punteggi da caratteristiche (somiglianza, sinonimi, compatibilita' del valore,
// memoria del sito) trasformati in probabilita' con una softmax a temperatura calibrata (vedi docs/calibrazione.md).
// Come in Jev: c'e' sempre l'opzione "nessuno"; la confidenza decide se agire o chiedere a Claude.

/** Temperatura e punteggio dell'opzione "nessuno": stimati da test/calibrate.mjs su casi etichettati. */
export const CAL = { T: 0.9, NONE: 4 };

/** Soglie per tipo di decisione (stessi preset di jev-mcp): act = agisce, escalate = sotto chiede. */
export const PRESETS = {
  cautious: { act: 0.9, escalate: 0.7, margin: 0.3 },
  balanced: { act: 0.85, escalate: 0.55, margin: 0.25 },
  // pickFirstOnTie: con suggerimenti ugualmente buoni (citta' / aeroporto / stazione) sceglie il primo, che e' quello che il sito mette in testa
  autonomous: { act: 0.6, escalate: 0.2, margin: 0.1, pickFirstOnTie: true },
};

const STOP = new Set('di del della dello dei degli delle dell all dall nell sull il lo la i gli le l d e ed a ad da in per con su un una the of and or to for a an de du des la le les el los las y en der die das und von zu mit do da dos das o no na em'.split(' '));

export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-./\\*:()[\]"'’`,;!?#~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// sinonimi multilingue (it, en, fr, es, de, pt) per i campi tipici dei moduli e dei portali italiani
const CONCEPTS = {
  company: ['ragione sociale', 'denominazione', 'denominazione sociale', 'azienda', 'impresa', 'societa', 'nome azienda', 'nome impresa', 'company', 'company name', 'business name', 'organization', 'organisation', 'raison sociale', 'entreprise', 'nom de l entreprise', 'razon social', 'empresa', 'nombre de la empresa', 'firmenname', 'unternehmen', 'firma', 'nome da empresa'],
  vat: ['partita iva', 'p iva', 'piva', 'numero partita iva', 'vat', 'vat number', 'vat id', 'numero iva', 'tva', 'numero de tva', 'numero tva', 'iva', 'cif', 'numero de iva', 'ust id', 'ust idnr', 'umsatzsteuer id', 'umsatzsteuer identifikationsnummer', 'nif iva'],
  taxcode: ['codice fiscale', 'cf', 'c f', 'cod fiscale', 'fiscal code', 'tax code', 'tax id', 'taxpayer id', 'codice fiscale azienda', 'numero fiscal', 'numero d identification fiscale', 'steuernummer', 'steuer id', 'nif', 'cpf'],
  email: ['email', 'e mail', 'mail', 'indirizzo email', 'posta elettronica', 'email address', 'courriel', 'adresse e mail', 'adresse electronique', 'correo', 'correo electronico', 'e mail adresse', 'emailadresse', 'endereco de email'],
  pec: ['pec', 'posta elettronica certificata', 'posta certificata', 'indirizzo pec', 'pec aziendale', 'certified email'],
  phone: ['telefono', 'tel', 'numero di telefono', 'cellulare', 'recapito telefonico', 'phone', 'phone number', 'mobile', 'telephone', 'numero de telephone', 'portable', 'telefonnummer', 'telefon', 'handy', 'telefone', 'celular', 'movil'],
  zip: ['cap', 'codice postale', 'codice avviamento postale', 'zip', 'zip code', 'postal code', 'postcode', 'code postal', 'codigo postal', 'plz', 'postleitzahl'],
  city: ['comune', 'citta', 'localita', 'comune sede', 'city', 'town', 'municipality', 'ville', 'commune', 'ciudad', 'municipio', 'localidad', 'stadt', 'ort', 'gemeinde', 'cidade', 'concelho'],
  province: ['provincia', 'prov', 'province', 'county', 'departement', 'kreis', 'landkreis', 'distrito'],
  region: ['regione', 'region', 'state', 'estado', 'comunidad autonoma', 'bundesland'],
  country: ['nazione', 'paese', 'stato estero', 'country', 'pays', 'pais', 'land'],
  address: ['indirizzo', 'via', 'indirizzo sede legale', 'sede legale', 'indirizzo sede', 'address', 'street', 'street address', 'adresse', 'rue', 'direccion', 'calle', 'domicilio', 'strasse', 'anschrift', 'endereco', 'morada', 'rua'],
  firstname: ['nome', 'first name', 'given name', 'firstname', 'prenom', 'nombre', 'vorname', 'primeiro nome', 'nome proprio'],
  lastname: ['cognome', 'last name', 'surname', 'family name', 'lastname', 'nom de famille', 'nom', 'apellido', 'apellidos', 'nachname', 'familienname', 'sobrenome', 'apelido'],
  fullname: ['nome e cognome', 'cognome e nome', 'cognome nome', 'nome cognome', 'nominativo', 'nome del referente', 'referente', 'full name', 'nom complet', 'nombre completo', 'vollstandiger name', 'nome completo'],
  birthdate: ['data di nascita', 'nato il', 'date of birth', 'birth date', 'birthday', 'date de naissance', 'fecha de nacimiento', 'geburtsdatum', 'data de nascimento'],
  birthplace: ['luogo di nascita', 'comune di nascita', 'nato a', 'place of birth', 'lieu de naissance', 'lugar de nacimiento', 'geburtsort', 'local de nascimento'],
  timestart: ['ora inizio', 'ora di inizio', 'orario inizio', 'orario di inizio', 'dalle ore', 'start time', 'heure de debut', 'hora de inicio', 'hora inicio', 'startzeit', 'beginnzeit', 'uhrzeit von'],
  timeend: ['ora fine', 'ora di fine', 'orario fine', 'orario di fine', 'alle ore', 'end time', 'heure de fin', 'hora de fin', 'hora fin', 'endzeit', 'uhrzeit bis'],
  datestart: ['data inizio', 'inizio', 'data di inizio', 'dal', 'data avvio', 'start date', 'start', 'from', 'date de debut', 'debut', 'fecha de inicio', 'inicio', 'startdatum', 'beginn', 'data de inicio'],
  dateend: ['data fine', 'fine', 'data di fine', 'al', 'data termine', 'scadenza', 'end date', 'end', 'to', 'date de fin', 'fin', 'fecha de fin', 'enddatum', 'ende', 'data de fim', 'termino'],
  description: ['descrizione', 'descrizione degli obiettivi', 'obiettivi', 'note', 'dettagli', 'description', 'details', 'notes', 'commentaire', 'descripcion', 'beschreibung', 'anmerkungen', 'descricao', 'observacoes'],
  title: ['titolo', 'titolo del piano', 'titolo progetto', 'oggetto', 'title', 'subject', 'titre', 'objet', 'titulo', 'asunto', 'titel', 'betreff', 'assunto'],
  ateco: ['ateco', 'codice ateco', 'attivita economica', 'settore', 'nace', 'codice attivita', 'naf', 'cnae', 'wz code'],
  hours: ['ore', 'numero ore', 'ore di formazione', 'monte ore', 'durata ore', 'hours', 'heures', 'horas', 'stunden'],
  employees: ['dipendenti', 'numero dipendenti', 'dipendenti coinvolti', 'lavoratori', 'partecipanti', 'employees', 'staff', 'headcount', 'salaries', 'effectif', 'empleados', 'trabajadores', 'mitarbeiter', 'beschaftigte', 'funcionarios', 'trabalhadores'],
  role: ['ruolo', 'qualifica', 'in qualita di', 'role', 'position', 'job title', 'fonction', 'poste', 'cargo', 'puesto', 'rolle', 'funktion', 'funcao'],
  fund: ['fondo', 'fonte di finanziamento', 'finanziamento', 'fondo interprofessionale', 'fund', 'funding', 'funding source', 'financement', 'financiacion', 'finanzierung', 'financiamento'],
  mode: ['modalita', 'modalita di erogazione', 'erogazione', 'delivery mode', 'mode', 'modalite', 'modalidad', 'modus', 'modalidade'],
  username: ['username', 'nome utente', 'utente', 'login', 'user', 'identifiant', 'usuario', 'benutzername'],
  message: ['messaggio', 'annotazioni', 'note', 'commento', 'osservazioni', 'testo', 'message', 'comments', 'comment', 'commentaire', 'commentaires', 'comentarios', 'comentario', 'mensaje', 'anmerkungen', 'nachricht', 'bemerkungen', 'mensagem', 'comentarios'],
  legalform: ['forma giuridica', 'tipo di societa', 'natura giuridica', 'legal form', 'company type', 'forme juridique', 'forma juridica', 'rechtsform', 'natureza juridica'],
  revenue: ['fatturato', 'ricavi', 'volume d affari', 'turnover', 'revenue', 'chiffre d affaires', 'facturacion', 'umsatz', 'faturamento'],
  category: ['categoria', 'categoria merceologica', 'settore merceologico', 'settore', 'category', 'sector', 'categorie', 'kategorie', 'branche'],
  contact: ['referente', 'persona di riferimento', 'contatto', 'contact person', 'contact', 'interlocuteur', 'persona de contacto', 'ansprechpartner', 'pessoa de contato'],
  terms: ['termini e condizioni', 'condizioni', 'condizioni generali', 'termini', 'terms', 'terms and conditions', 'conditions generales', 'conditions', 'terminos y condiciones', 'condiciones', 'agb', 'allgemeine geschaftsbedingungen', 'geschaftsbedingungen', 'termos e condicoes'],
  privacy: ['privacy', 'informativa privacy', 'trattamento dei dati', 'trattamento dati', 'consenso privacy', 'dati personali', 'data protection', 'privacy policy', 'protection des donnees', 'donnees personnelles', 'proteccion de datos', 'datos personales', 'datenschutz', 'datenschutzerklarung', 'gdpr', 'rgpd', 'dsgvo'],
  truthful: ['dichiarazione sostitutiva', 'veridicita', 'dati veritieri', 'dpr 445', 'dpr 445 2000', 'autocertificazione'],
  // v0.4: concetti generici dei moduli (persone, luoghi, importi, uffici, viaggi)
  place: ['luogo', 'sede', 'sede di svolgimento', 'destinazione', 'luogo di svolgimento', 'location', 'venue', 'place', 'destination', 'lieu', 'lugar', 'destino', 'veranstaltungsort', 'zielort', 'reiseziel', 'local'],
  teacher: ['docente', 'formatore', 'insegnante', 'relatore', 'istruttore', 'tutor', 'teacher', 'trainer', 'instructor', 'speaker', 'formateur', 'enseignant', 'intervenant', 'profesor', 'formador', 'ponente', 'dozent', 'lehrer', 'referent', 'professor'],
  topics: ['argomenti', 'argomenti trattati', 'contenuti', 'contenuto', 'programma', 'temi', 'topics', 'contents', 'content', 'agenda', 'sujets', 'contenu', 'programme', 'temas', 'contenidos', 'temario', 'themen', 'inhalte', 'inhalt', 'conteudo'],
  purpose: ['motivo', 'motivazione', 'finalita', 'scopo', 'causale', 'purpose', 'reason', 'motif', 'raison', 'proposito', 'finalidad', 'zweck', 'grund', 'anlass', 'finalidade'],
  amount: ['importo', 'importo totale', 'totale', 'somma', 'ammontare', 'amount', 'total', 'total amount', 'sum', 'montant', 'montant total', 'importe', 'importe total', 'betrag', 'gesamtbetrag', 'summe', 'valor total'],
  department: ['ufficio', 'servizio', 'reparto', 'dipartimento', 'unita organizzativa', 'struttura di appartenenza', 'department', 'office', 'division', 'service', 'departement', 'departamento', 'abteilung', 'dienststelle'],
  departure: ['partenza', 'andata', 'departure', 'outbound', 'depart', 'aller', 'salida', 'ida', 'abreise', 'abfahrt', 'hinreise'],
  return: ['rientro', 'ritorno', 'return', 'inbound', 'retour', 'regreso', 'vuelta', 'ruckkehr', 'ruckreise', 'volta'],
  distance: ['chilometri', 'km', 'distanza', 'kilometers', 'kilometres', 'miles', 'mileage', 'distance', 'kilometrage', 'distancia', 'kilometros', 'kilometer', 'entfernung', 'strecke'],
  receipts: ['giustificativi', 'giustificativi di spesa', 'ricevute', 'scontrini', 'fatture', 'documentazione di spesa', 'receipts', 'invoices', 'justificatifs', 'factures', 'recibos', 'justificantes', 'facturas', 'belege', 'quittungen', 'rechnungen'],
  confirm: ['confermo', 'conferma', 'attesto', 'correttezza', 'i confirm', 'confirm', 'je confirme', 'confirmo', 'ich bestatige', 'bestatigung'],
};
// parole generiche: contano poco da sole (numero, codice, data, nome...)
// parole di domanda ignorate nelle chiavi di estrazione ("quanti progetti", "how many projects")
const ASKW = new Set('quanti quante quanto quanta quale quali qual totale how many much count combien cuantos cuantas cuanto wie viele'.split(' '));
const GENERIC = new Set('numero n num nr codice cod data date nome name tipo type id code number no indirizzo campo field valore value'.split(' '));
// frase -> concetti (una stessa frase puo' appartenere a piu' concetti, es. "note", "settore")
const PMAP = new Map();
for (const [c, list] of Object.entries(CONCEPTS)) for (const p of list) {
  const k = fold(p);
  if (!PMAP.has(k)) PMAP.set(k, new Set());
  PMAP.get(k).add(c);
}
const PHRASES = [...PMAP.entries()].sort((a, b) => b[0].length - a[0].length);

/** Concetti riconosciuti in un testo: la frase piu' lunga assorbe le piu' corte ("tipo di societa" non e' anche "societa"). */
const CC = new Map();
export function concepts(s) {
  const key = String(s ?? '');
  const hit = CC.get(key);
  if (hit) return hit;
  let f = ` ${fold(s)} `;
  const out = new Set();
  for (const [p, cs] of PHRASES) {
    const k = ` ${p} `;
    if (f.includes(k)) {
      for (const c of cs) out.add(c);
      f = f.split(k).join(' | ');
    }
  }
  if (CC.size > 5000) CC.clear();
  CC.set(key, out);
  return out;
}
/** Svuota le cache (le misure di latenza partono "a freddo"). */
export function resetCaches() {
  CC.clear();
  SC.clear();
}

// varianti della stessa parola che la radice di 5 lettere non unisce
const ALIAS = { orario: 'ora', orari: 'ora', horaire: 'heure', horario: 'hora' };
const tokens = (s) => fold(s).split(' ').filter((t) => t && !STOP.has(t)).map((t) => ALIAS[t] || t);
const stem = (t) => (t.length > 5 ? t.slice(0, 5) : t);
function bigrams(s) {
  const f = fold(s).replace(/ /g, '');
  const m = new Map();
  for (let i = 0; i < f.length - 1; i++) {
    const g = f.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return [m, Math.max(0, f.length - 1)];
}
function dice(a, b) {
  const [A, na] = bigrams(a);
  const [B, nb] = bigrams(b);
  if (!na || !nb) return 0;
  let inter = 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
  return (2 * inter) / (na + nb);
}

/** Somiglianza 0..1 tra due etichette (uguaglianza, sinonimi, parole, refusi). */
const SC = new Map();
export function similarity(a, b) {
  const key = `${a}\u0000${b}`;
  const hit = SC.get(key);
  if (hit !== undefined) return hit;
  const v = similarityRaw(a, b);
  if (SC.size > 20000) SC.clear();
  SC.set(key, v);
  return v;
}
function similarityRaw(a, b) {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  const ca = concepts(fa);
  const cb = concepts(fb);
  let common = 0;
  for (const c of ca) if (cb.has(c)) common++;
  // piu' concetti in comune = corrispondenza piu' forte ("codice fiscale azienda" batte "ragione sociale")
  const conceptScore = common ? 0.6 + 0.37 * (common / (ca.size + cb.size - common)) : 0;
  // concetti in conflitto (es. "nome" vs "cognome", "data inizio" vs "data fine") abbassano il punteggio
  const conflict = ca.size && cb.size && !common;
  const ta = tokens(fa);
  const tbl = tokens(fb);
  // corrispondenza tra parole: stessa radice (5 lettere) = 1, prefisso comune di almeno 4 lettere = parziale
  const tokScore = (t) => {
    let best = 0;
    for (const b of tbl) {
      if (stem(t) === stem(b)) return 1;
      let cp = 0;
      while (cp < t.length && cp < b.length && t[cp] === b[cp]) cp++;
      if (cp >= 4) best = Math.max(best, cp / Math.max(t.length, b.length));
    }
    return best;
  };
  const w = (t) => (GENERIC.has(t) ? 0.3 : 1);
  const inter = ta.reduce((acc, t) => acc + w(t) * tokScore(t), 0);
  const wa = ta.reduce((acc, t) => acc + w(t), 0);
  const wb = tbl.reduce((acc, t) => acc + w(t), 0);
  const jac = wa + wb ? inter / (wa + wb - inter) : 0;
  const contain = ta.length && ta.every((t) => tokScore(t) === 1) && ta.some((t) => !GENERIC.has(t)) ? 0.86 : 0;
  const d = dice(fa, fb);
  let s = Math.max(contain, 0.55 * jac + 0.45 * d * (jac > 0 ? 1 : 0.6), conceptScore);
  if (conflict) s *= 0.45;
  return Math.min(1, s);
}

/**
 * Domanda "choice": logit per opzione -> probabilita' (softmax con temperatura) + opzione "nessuno".
 * Restituisce { choice, p, probs: [{key, p}], confidence, margin }.
 */
export function choice(options, { T = CAL.T, none = CAL.NONE } = {}) {
  const all = [...options.map((o) => ({ key: o.key, logit: o.logit, data: o.data })), { key: null, logit: none }];
  const mx = Math.max(...all.map((o) => o.logit));
  const ex = all.map((o) => Math.exp((o.logit - mx) / T));
  const z = ex.reduce((a, b) => a + b, 0);
  const probs = all.map((o, i) => ({ key: o.key, p: ex[i] / z, data: o.data })).sort((a, b) => b.p - a.p);
  const top = probs[0];
  return { choice: top.key, p: top.p, data: top.data, probs, confidence: top.p, margin: top.p - (probs[1] ? probs[1].p : 0) };
}

/** Decisione secondo il preset: 'act' | 'ask'. Tra le due soglie serve un margine netto sul secondo (seconda occhiata). */
export function decide(res, preset = PRESETS.balanced) {
  if (res.choice === null) return 'ask';
  if (res.confidence >= preset.act) return 'act';
  if (res.confidence >= preset.escalate && res.margin >= preset.margin) return 'act';
  return 'ask';
}

// ---------------- valori ----------------
const DATE_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$|^(\d{4})-(\d{1,2})-(\d{1,2})$/;
export function parseDate(v) {
  const s = String(v).trim();
  const m = s.match(DATE_RE);
  if (!m) return null;
  let d, mo, y;
  if (m[4]) [y, mo, d] = [+m[4], +m[5], +m[6]];
  else [d, mo, y] = [+m[1], +m[2], +m[3] < 100 ? 2000 + +m[3] : +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { d, mo, y };
}
const pad = (n) => String(n).padStart(2, '0');

/** Kind del valore richiesto: date, time, email, path, number, bool, long, text. */
export function valueKind(v) {
  if (typeof v === 'boolean') return 'bool';
  const s = String(v ?? '').trim();
  if (/^(true|false|si|sì|no|yes)$/i.test(s)) return 'bool';
  if (parseDate(s)) return 'date';
  if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) return 'time';
  if (s.length < 260 && !/\n/.test(s) && /^([a-z]:)?[\\/]|[\\/][^\\/]+\.[a-z0-9]{2,5}$/i.test(s)) return 'path';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'email';
  if (/^[+-]?\d+([.,]\d+)?$/.test(s)) return 'number';
  if (s.length > 50) return 'long';
  return 'text';
}

/** Adatta una data al campo: AAAA-MM-GG per i campi data nativi, GG/MM/AAAA (o il formato del placeholder) per i campi testo. */
export function formatDateFor(v, item) {
  const p = parseDate(v);
  if (!p) return String(v);
  if (item.role === 'date' || (item.gx && item.gx.ty === 'date')) return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
  const ph = fold((item.gx && item.gx.ph) || item.name);
  if (/(mm|mese) (gg|dd)/.test(ph)) return `${pad(p.mo)}/${pad(p.d)}/${p.y}`;
  if (/(aaaa|yyyy|jjjj) (mm|mese)/.test(ph)) return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
  const sep = /\d{2}\.\d{2}/.test((item.gx && item.gx.ph) || '') || /tt mm jjjj/.test(ph) ? '.' : '/';
  return `${pad(p.d)}${sep}${pad(p.mo)}${sep}${p.y}`;
}

export const truthy = (v) => v === true || /^(true|si|sì|yes|1|x|on)$/i.test(String(v).trim());

// ---------------- abbinamento parametro -> campo ----------------
const FILLABLE = /^(text|area|sel|combo|num|date|edit|chk|sw|rad|file|pwd)$/;

/** Candidati: campi compilabili; i radio con lo stesso name diventano un gruppo unico. */
export function fieldsFrom(items, regions) {
  const out = [];
  const groups = new Map();
  for (const it of items) {
    if (!FILLABLE.test(it.role)) continue;
    const r = regions[it.reg];
    if (r && r.low && it.role !== 'text' && it.role !== 'sel') continue;
    if (it.role === 'rad' && it.gx && it.gx.grpName) {
      let g = groups.get(it.gx.grpName);
      if (!g) {
        g = { kind: 'radio', id: it.id, role: 'radgroup', name: it.gx.glab || it.gx.grpName, items: [], reg: it.reg, low: !!(r && r.low), leg: it.gx.leg || '', texts: [it.gx.glab, it.gx.grpName].filter(Boolean) };
        groups.set(it.gx.grpName, g);
        out.push(g);
      }
      g.items.push(it);
      out.push({ kind: 'field', id: it.id, role: 'rad', name: it.name, item: it, reg: it.reg, low: !!(r && r.low), leg: '', texts: [it.name] });
      continue;
    }
    const gx = it.gx || {};
    out.push({ kind: 'field', id: it.id, role: it.role, name: it.name, item: it, reg: it.reg, low: !!(r && r.low), leg: gx.leg || '', texts: [gx.full || it.name, gx.near, gx.ph, gx.nm].filter(Boolean) });
    // un radio puo' essere indicato anche da solo (es. "Legale rappresentante": true)
    if (it.role === 'rad') out[out.length - 1].texts = [gx.full || it.name];
  }
  return addDateGroups(items, regions, out);
}

// ---------------- date in piu' campi (giorno / mese / anno, ore / minuti) ----------------
const PART_WORDS = {
  d: 'giorno gg day dd tag tt jour jj dia',
  mo: 'mese month mm monat mois mes',
  y: 'anno aaaa yyyy yy aa year jahr annee ano jjjj',
  h: 'ore ora hh hour hours stunde heure hora',
  mi: 'minuti minuto min minute minutes minuten',
};
const PART_SETS = Object.fromEntries(Object.entries(PART_WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));
const AMBIG_PART = new Set(['ore', 'ora', 'hours', 'min', 'hora', 'heure', 'stunde']);
const MONTHS = [
  'gennaio january januar janvier enero', 'febbraio february februar fevrier febrero', 'marzo march marz mars', 'aprile april avril abril',
  'maggio may mai mayo', 'giugno june juni juin junio', 'luglio july juli juillet julio', 'agosto august aout',
  'settembre september septembre septiembre setiembre', 'ottobre october oktober octobre octubre', 'novembre november noviembre', 'dicembre december dezember decembre diciembre',
].map((s) => s.split(' '));
const partTokens = (s) => fold(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2')).split(' ').filter(Boolean);
const intOf = (s) => (/^\s*\d{1,4}\s*$/.test(String(s)) ? parseInt(s, 10) : null);

/** Numero del mese (1-12) da un'opzione: "06", "6", "giugno", "Jun", "juin"; null se non e' un mese o e' ambiguo. */
export function monthOf(opt) {
  const n = intOf(opt);
  if (n !== null) return n >= 1 && n <= 12 ? n : null;
  const o = fold(opt).replace(/\s.*$/, '');
  if (o.length < 3) return null;
  const hits = MONTHS.map((names, i) => (names.some((m) => m === o || m.startsWith(o) || o.startsWith(m)) ? i + 1 : 0)).filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

/** Parte di data di un campo dal nome, dall'attributo name/id, dal placeholder o dalle opzioni del menu. */
function datePart(it) {
  const gx = it.gx || {};
  for (const src of [gx.nm, gx.ph, it.name]) {
    const t = partTokens(src);
    const ks = ['d', 'mo', 'y', 'h', 'mi'].filter((k) => t.some((w) => PART_SETS[k].has(w)));
    // "gg/mm/aaaa" o "hh:mm" in un solo campo: e' una data o un orario intero, non una parte
    if (ks.length > 1) return null;
    // "Ore" / "ora" in un campo di testo e' spesso un numero di ore, non l'ora di una data: vale solo per i menu
    if (ks.length === 1 && /^(h|mi)$/.test(ks[0]) && it.role !== 'sel' && t.filter((w) => PART_SETS[ks[0]].has(w)).every((w) => AMBIG_PART.has(w))) continue;
    if (ks.length === 1) return ks[0];
  }
  const opts = (gx.opts || []).filter((o) => fold(o) && !/^(seleziona|scegli|select|choose|--|gg|mm|aaaa|yyyy)/.test(fold(o)));
  if (opts.length >= 12) {
    const nums = opts.map(intOf);
    if (nums.every((n) => n !== null)) {
      const max = Math.max(...nums);
      if (nums.every((n) => n >= 1900 && n <= 2200)) return 'y';
      if (opts.length >= 28 && opts.length <= 31 && max <= 31 && Math.min(...nums) >= 1) return 'd';
      if (opts.length === 12 && max === 12) return 'mo';
    } else if (opts.length === 12 && opts.every((o) => monthOf(o))) return 'mo';
  }
  return null;
}

/** Testo comune ai nomi delle parti senza le parole di data ("Partenza giorno" + "Partenza mese" -> "Partenza"). */
function sharedLabel(names) {
  const words = names.map((n) => partTokens(n).filter((w) => !Object.values(PART_SETS).some((s) => s.has(w))));
  if (!words.length || !words[0].length) return '';
  const common = words[0].filter((w) => words.every((ws) => ws.includes(w)));
  return common.join(' ');
}

/** Gruppi di campi consecutivi giorno+mese+anno (ore e minuti facoltativi): diventano un solo campo "data". */
function addDateGroups(items, regions, out) {
  const runs = [];
  let cur = null;
  for (const it of items) {
    const ok = /^(sel|text|num|combo)$/.test(it.role) && !it.flags.includes('off');
    const part = ok ? datePart(it) : null;
    if (!part || !cur || cur.reg !== it.reg || cur.parts.some((x) => x.part === part)) {
      if (cur) runs.push(cur);
      cur = part ? { reg: it.reg, parts: [] } : null;
    }
    if (cur && part) cur.parts.push({ part, it });
  }
  if (cur) runs.push(cur);
  for (const run of runs) {
    const has = (k) => run.parts.some((x) => x.part === k);
    if (!(has('d') && has('mo') && has('y'))) continue;
    const first = run.parts[0].it;
    const gx = first.gx || {};
    const any = (k) => run.parts.map((x) => x.it.gx && x.it.gx[k]).find(Boolean) || '';
    const r = regions[first.reg];
    const shared = sharedLabel(run.parts.map((x) => x.it.name));
    const own = partTokens(first.name).some((w) => PART_SETS[run.parts[0].part].has(w)) ? '' : first.name;
    const nmBase = sharedLabel(run.parts.map((x) => (x.it.gx && x.it.gx.nm) || ''));
    const texts = [any('grp'), own, shared, any('leg'), gx.near, nmBase].filter(Boolean);
    const name = texts[0] || 'data';
    for (const x of run.parts) {
      const f = out.find((o) => o.kind === 'field' && o.id === x.it.id);
      if (f) f.part = x.part;
    }
    out.push({ kind: 'dateparts', id: first.id + '+', role: 'dateparts', name, parts: run.parts, reg: first.reg, low: !!(r && r.low), leg: gx.leg || '', texts: texts.length ? texts : ['data'] });
  }
  return out;
}

/** Data (e ora facoltativa) da un valore: "12/06/2025", "2025-06-12 10:30", "2025-06-12T10:30". */
export function parseDateTime(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\S+?)(?:[ T]+(\d{1,2})[:.](\d{2})(?::\d{2})?)?$/);
  if (!m) return null;
  const d = parseDate(m[1]);
  if (!d) return null;
  return m[2] ? { ...d, h: +m[2], mi: +m[3] } : d;
}

/** Quanto il valore e' compatibile con il campo (0..1, negativo se incompatibile). */
function valueFit(value, f) {
  const k = valueKind(value);
  const it = f.item || {};
  const gx = it.gx || {};
  if (f.kind === 'radio') {
    const best = Math.max(0, ...f.items.map((r) => similarity(String(value), r.name)));
    return k === 'bool' ? -0.3 : best > 0.8 ? 1 : best > 0.5 ? 0.4 : -0.2;
  }
  if (f.kind === 'dateparts') return parseDateTime(value) ? 1 : -0.8;
  // una data intera non entra nel solo campo "giorno" o "mese" di una data divisa
  if (f.part && (k === 'date' || parseDateTime(value))) return -0.6;
  switch (f.role) {
    case 'chk':
    case 'sw':
    case 'rad':
      // una casella o un radio singolo si spuntano con un si/no, mai con un testo
      return k === 'bool' ? 0.8 : -0.8;
    case 'sel': {
      const opts = gx.opts || [];
      const best = Math.max(0, ...opts.map((o) => optionScore(value, o)));
      return best >= 0.9 ? 1 : best >= 0.6 ? 0.5 : -0.4;
    }
    case 'date':
      return k === 'date' || (k === 'time' && gx.ty === 'time') ? 1 : -0.8;
    case 'num':
      return k === 'number' ? 0.6 : -0.6;
    case 'file':
      return k === 'path' ? 0.8 : /[\\/]/.test(String(value)) ? 0.3 : -1;
    case 'area':
      return k === 'long' ? 0.6 : k === 'text' ? 0.1 : 0;
    default: {
      const ph = fold(gx.ph);
      const timeField = gx.ty === 'time' || /\b(hh|oo) mm\b/.test(ph) || concepts(f.name).has('timestart') || concepts(f.name).has('timeend');
      if (k === 'time') return timeField ? 1 : -0.1;
      if (timeField) return -0.4;
      if (k === 'date') return /(gg|dd|aaaa|yyyy|jj|tt)/.test(ph) || concepts(f.name).has('datestart') || concepts(f.name).has('dateend') || concepts(f.name).has('birthdate') ? 0.8 : -0.2;
      if (k === 'email') return gx.ty === 'email' || concepts(f.name).has('email') || concepts(f.name).has('pec') ? 0.8 : -0.3;
      if (k === 'bool') return -0.8;
      if (k === 'path') return -0.2;
      if (k === 'number' && gx.ty === 'tel') return 0.3;
      return 0.1;
    }
  }
}

/** Punteggio di un'opzione di menu rispetto al valore richiesto (codice iniziale, uguaglianza, parole). */
export function optionScore(value, opt) {
  const v = fold(value);
  const o = fold(opt);
  if (!v || !o) return 0;
  if (v === o) return 1;
  if (o.startsWith(v + ' ') || o.startsWith(v)) return /^\d+$/.test(v) ? 0.97 : 0.9;
  if (` ${o} `.includes(` ${v} `)) return 0.85;
  return similarity(v, o) * 0.9;
}

/**
 * Abbina un parametro { key, about, value } ai campi. memory: mappa dal sito (chiave -> nome campo).
 * Logit = 7*somiglianza etichetta + 2*compatibilita' valore + 9*memoria + piccoli bonus.
 * La memoria e' una risposta gia' data dall'utente su questo sito: pesa quasi come un riferimento esplicito.
 */
export function groundParam(param, fields, memory = {}) {
  return choice(paramLogits(param, fields, memory));
}

/** Logit grezzi per ogni campo candidato (usati anche dalla calibrazione). */
export function paramLogits(param, fields, memory = {}) {
  const query = [param.key, param.about].filter(Boolean);
  const mem = memory[fold(param.key)];
  const opts = fields.map((f) => {
    const name = Math.max(...query.map((q) => Math.max(...f.texts.map((t) => similarity(q, t)))));
    const fit = valueFit(param.value, f);
    const remembered = mem && fold(mem) === fold(f.name) ? 1 : 0;
    const req = f.item && f.item.flags.includes('req') ? 0.15 : 0;
    const low = f.low ? -1 : 0;
    const leg = f.leg ? 0.8 * Math.max(...query.map((q) => similarity(q, f.leg))) : 0;
    return { key: f.id, logit: 7 * name + 2 * fit + 9 * remembered + req + low + leg, data: { f, name, fit, remembered } };
  });
  // esclusivita': un valore di forma inconfondibile (orario, file, data, email, si/no) con un solo campo adatto
  // va quasi certamente li', anche se l'etichetta usa parole diverse ("foglio firme" -> "Allegato registro presenze")
  const minName = EXCL_KINDS[valueKind(param.value)];
  if (minName !== undefined) {
    const fitting = opts.filter((o) => o.data.fit >= 0.8 && !o.data.f.low);
    if (fitting.length === 1 && fitting[0].data.name >= minName) {
      fitting[0].logit += EXCL;
      fitting[0].data.excl = true;
    }
  }
  return opts;
}
// tipi di valore per l'esclusivita' -> somiglianza minima dell'etichetta richiesta
// (orari e file sono inconfondibili; date, email e si/no hanno molti parametri "senza campo" e chiedono un indizio nel nome)
const EXCL_KINDS = { time: 0, path: 0, date: 0.3, email: 0.3, bool: 0.3 };
const EXCL = 2.5;

/**
 * Assegna i parametri ai campi per un intero compito. fixed: abbinamenti gia' certi ({ p, f, conf }).
 * Prima ogni parametro da solo; poi i parametri incerti o in conflitto si riabbinano sui soli campi rimasti
 * liberi (assegnazione congiunta), finche' non cambia piu' nulla.
 * Restituisce { acts: [{ p, f, conf, r }], asks: [[p, r, extra]], taken: Set di id dei campi assegnati }.
 */
export function assign(params, fields, { memory = {}, preset = PRESETS.balanced, fixed = [] } = {}) {
  const byField = new Map();
  for (const st of fixed) byField.set(st.f.id, st);
  let pending = params.map((p) => [p, null, '']);
  let pool = fields.filter((f) => !byField.has(f.id));
  for (let round = 0; round < 4 && pending.length; round++) {
    const plan = [];
    const next = [];
    for (const [p, , extra] of pending) {
      const r = groundParam(p, pool, memory);
      if (decide(r, preset) === 'act') plan.push({ p, f: r.data.f, conf: r.confidence, r, extra });
      else next.push([p, r, extra]);
    }
    // due parametri sullo stesso campo: resta il piu' sicuro, l'altro riprova sui campi rimasti
    let added = 0;
    for (const st of plan.sort((a, b) => b.conf - a.conf)) {
      if (byField.has(st.f.id)) next.push([st.p, st.r, ' (campo conteso)']);
      else { byField.set(st.f.id, { p: st.p, f: st.f, conf: st.conf, r: st.r }); added++; }
    }
    pending = next;
    if (!added) break;
    pool = fields.filter((f) => !byField.has(f.id));
  }
  return { acts: [...byField.values()], asks: pending, taken: new Set(byField.keys()) };
}

/** Sceglie l'opzione di menu (o il suggerimento di autocompletamento) piu' vicina al valore. */
export function chooseOption(value, options) {
  const opts = options.map((o, i) => ({ key: i, logit: 8 * optionScore(value, o), data: o }));
  return choice(opts, { none: 4.2 });
}

// ---------------- estrazione tipizzata ----------------
const NUM = (s) => {
  const m = String(s).match(/[-+]?\d{1,3}(?:[.\s']\d{3})*(?:,\d+)?|[-+]?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  let t = m[0].replace(/[\s']/g, '');
  if (/,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
export function convert(raw, type) {
  const s = String(raw ?? '').trim();
  switch (type) {
    case 'number':
      return NUM(s);
    case 'money': {
      const n = NUM(s);
      if (n === null) return null;
      const cur = /€|eur/i.test(s) ? 'EUR' : /\$|usd/i.test(s) ? 'USD' : /£|gbp/i.test(s) ? 'GBP' : '';
      return cur ? `${n.toFixed(2)} ${cur}` : n.toFixed(2);
    }
    case 'date': {
      const m = s.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/);
      const p = m && parseDate(m[1]);
      return p ? `${p.y}-${pad(p.mo)}-${pad(p.d)}` : null;
    }
    case 'url': {
      const m = s.match(/https?:\/\/\S+/);
      return m ? m[0] : null;
    }
    default:
      return s || null;
  }
}

/** Valore che segue un'etichetta in una riga ("Protocollo n. 2026/004512 del ..." -> "2026/004512 del ..."). */
function afterLabel(line, key) {
  const fl = line;
  const words = tokens(key);
  if (!words.length) return null;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\S*').join('[\\s\\S]{0,12}?'), 'i');
  const plain = fl.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = plain.match(re);
  if (!m) return null;
  let rest = fl.slice(m.index + m[0].length).replace(/^[\s:=\-–—]*(n\.?|nr\.?|no\.?|num\.?|numero|#)?\s*/i, '');
  return rest.trim() || null;
}

/**
 * Estrae un campo { key, type } dai dati della pagina (coppie etichetta-valore, righe, tabelle).
 * Restituisce { value, confidence, from } oppure { value: null } se non trovato (opzione "non indicato").
 */
export function extractField(field, page) {
  if (field.type === 'table') {
    const t = page.tables
      .map((tb, i) => ({ key: i, logit: 6 * Math.max(similarity(field.key, tb.head.join(' ')), 0.3) + Math.min(2, tb.rows.length / 10), data: tb }))
      .filter((o) => o.data.rows.length);
    if (!t.length) return { value: null, confidence: 0 };
    const r = choice(t, { none: 1.5 });
    if (r.choice === null) return { value: null, confidence: r.p };
    const tb = r.data;
    return { value: [tb.head.join('\t'), ...tb.rows.map((row) => row.join('\t'))].filter(Boolean).join('\n'), confidence: r.p, from: 'tabella' };
  }
  const cands = [];
  for (const p of page.pairs) {
    const sim = similarity(field.key, p.l);
    if (sim < 0.3) continue;
    const v = convert(p.v, field.type);
    if (v === null) continue;
    cands.push({ key: cands.length, logit: 7 * sim + 1.2, data: { v, from: p.k } });
  }
  // righe di testo: devono contenere tutte le parole "di contenuto" della chiave (le generiche come
  // "numero", "codice" e le parole di domanda come "quanti" possono mancare: "25 progetti trovati")
  const kt = tokens(field.key).filter((w) => !ASKW.has(w));
  const core = kt.filter((w) => !GENERIC.has(w));
  for (const line of page.lines) {
    const fl = fold(line);
    const lw = fl.split(' ');
    const hit = (w) => fl.includes(w) || (w.length >= 4 && lw.some((x) => x.length >= 4 && stem(x) === stem(w)));
    if (!core.length || !core.every(hit)) continue;
    const all = kt.every(hit);
    let rest = afterLabel(line, field.key);
    // testo che inizia con un codice ("2026/004512 del 28/10/2026"): resta il codice
    if (rest && field.type === 'text') {
      const code = rest.match(/^([A-Za-z0-9][\w./-]*\d[\w./-]*)(?=[\s,;(]|$)/);
      if (code && code[1].length < rest.length) rest = code[1].replace(/[.,]$/, '');
    }
    let v = rest != null ? convert(rest, field.type) : null;
    const after = v !== null;
    // numero accanto alla parola chiave ("25 progetti trovati", "progetti: 25")
    let near = false;
    if (v === null) {
      v = convert(line, field.type);
      if (v !== null && /^(number|money)$/.test(field.type)) {
        const ni = lw.findIndex((x) => /\d/.test(x));
        near = ni >= 0 && lw.some((x, i) => Math.abs(i - ni) <= 2 && core.some((w) => x === w || (w.length >= 4 && x.length >= 4 && stem(x) === stem(w))));
      }
    }
    if (v === null) continue;
    cands.push({ key: cands.length, logit: 7 * 0.85 + (after ? 0.6 : near ? 0.2 : -0.6) - (all ? 0 : 0.4) - Math.min(1, line.length / 200), data: { v, from: 'testo' } });
  }
  if (!cands.length) return { value: null, confidence: 0 };
  // stesso valore da piu' fonti: le probabilita' si sommano
  const r = choice(cands, { none: 5.2 });
  const agg = new Map();
  for (const pr of r.probs) if (pr.key !== null) agg.set(String(pr.data.v), (agg.get(String(pr.data.v)) || 0) + pr.p);
  const best = [...agg.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || (r.choice === null && best[1] < r.p)) return { value: null, confidence: r.p };
  const from = r.probs.find((pr) => pr.key !== null && String(pr.data.v) === best[0]).data.from;
  const val = field.type === 'number' ? Number(best[0]) : best[0];
  return { value: val, confidence: best[1], from };
}
