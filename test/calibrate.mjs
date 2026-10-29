// Calibrazione del motore decisionale: come Jev chiede probabilita' "oneste", qui si stimano temperatura (T)
// e punteggio dell'opzione "nessuno" (NONE) minimizzando la log-verosimiglianza su casi etichettati.
// Addestramento: modulo italiano (domanda1). Verifica: modulo di registrazione in 4 lingue (form.html), mai usato per stimare.
import fs from 'node:fs';
import path from 'node:path';
import { Session, loadConfig } from '../extension/server/lib/session.js';
import { fieldsFrom, paramLogits, fold, PRESETS } from '../extension/server/lib/engine.js';
import { serve } from './server.mjs';
import { TEST_ENV, TMP } from './mcp-client.mjs';

const TRAIN = {
  page: '/domanda1.html',
  cases: {
    'Ragione sociale': [['ragione sociale', 'denominazione', 'nome azienda', 'azienda', 'company name', 'raison sociale', 'razon social', 'Firmenname', 'ragione socile'], 'Alfa Meccanica S.r.l.'],
    'Partita IVA': [['partita iva', 'P.IVA', 'piva', 'VAT number', 'numero partita iva', 'TVA', 'partita iv'], '01234567890'],
    'Codice fiscale azienda': [['codice fiscale', 'CF', 'cod. fiscale', 'tax code', "codice fiscale dell'azienda"], '01234567890'],
    'Codice ATECO': [['ateco', 'codice ateco', 'settore ATECO', 'NACE code'], '62'],
    Regione: [['regione', 'region'], 'Campania'],
    Provincia: [['provincia', 'prov.', 'province'], 'Napoli'],
    Comune: [['comune', 'citta', 'city', 'Gemeinde', 'municipio'], 'Ischia'],
    'Indirizzo sede legale': [['indirizzo', 'sede legale', 'indirizzo sede', 'via', 'address', 'adresse', 'direccion'], 'Via Roma 1'],
    CAP: [['cap', 'codice postale', 'zip', 'postal code', 'PLZ', 'code postal'], '80077'],
    PEC: [['pec', 'posta certificata', 'PEC aziendale'], 'alfa@pec.it'],
    Telefono: [['telefono', 'tel.', 'cellulare', 'phone', 'Telefon'], '0815551234'],
    Nome: [['nome', 'nome referente', 'first name', 'prenom', 'Vorname', 'nombre'], 'Mario'],
    Cognome: [['cognome', 'cognome referente', 'last name', 'surname', 'nom de famille', 'Nachname', 'apellido'], 'Rossi'],
    Email: [['email', 'e-mail', 'mail', 'posta elettronica', 'courriel', 'correo'], 'mario@alfa.it'],
    'Titolo del piano': [['titolo', 'titolo del piano', 'titolo progetto', 'title'], 'Competenze digitali 2026'],
    'Fonte di finanziamento': [['fondo', 'fonte di finanziamento', 'finanziamento', 'funding'], 'Fondo Nuove Competenze'],
    'Numero dipendenti coinvolti': [['numero dipendenti', 'dipendenti', 'lavoratori coinvolti', 'employees', 'Mitarbeiter'], '12'],
    'Ore di formazione': [['ore', 'ore di formazione', 'monte ore', 'hours', 'Stunden'], '40'],
    'Data inizio': [['data inizio', 'inizio', 'data di inizio', 'dal', 'start date', 'date de debut', 'Startdatum'], '03/11/2026'],
    'Data fine (gg/mm/aaaa)': [['data fine', 'fine', 'data di fine', 'al', 'end date', 'date de fin', 'Enddatum'], '15/12/2026'],
    'Modalità di erogazione': [['modalita', 'modalita di erogazione', 'erogazione', 'delivery mode'], 'FAD sincrona'],
    'Descrizione degli obiettivi': [['descrizione', 'obiettivi', 'descrizione obiettivi', 'description', 'Beschreibung'], 'Sviluppare competenze digitali di base per tutto il personale coinvolto.'],
    "Dichiaro di aver letto l'informativa privacy e accetto il t…": [['privacy', 'informativa privacy', 'consenso privacy', 'trattamento dei dati'], true],
    'Dichiaro che i dati forniti sono veritieri ai sensi del DPR…': [['dichiarazione veridicita', 'dati veritieri', 'DPR 445/2000', 'dichiarazione sostitutiva'], true],
    'Ruolo': [['ruolo', 'ruolo del referente', 'qualifica', 'role'], 'Legale rappresentante'],
    'Visura camerale (PDF)': [['visura', 'visura camerale', 'documento visura'], 'C:\\documenti\\visura.pdf'],
  },
  none: [['IBAN', 'IT60X0542811101000000123456'], ['numero di matricola INPS', '1234567890'], ['data di nascita', '01/02/1980'], ['sesso', 'M'], ['nazionalita', 'italiana'], ['numero REA', 'NA-123456'], ['capitale sociale', '10000'], ['sito web', 'www.alfa.it'], ['fax', '0815550000'], ['codice SDI', 'ABC1234']],
};
const TEST_FIELDS = {
  company: [['ragione sociale', 'denominazione', 'nome azienda'], 'Alfa Meccanica S.r.l.'],
  vat: [['partita iva', 'P.IVA'], '01234567890'],
  street: [['indirizzo', 'via e numero civico'], 'Via Roma 1'],
  zip: [['cap', 'codice postale'], '80077'],
  city: [['comune', 'citta'], 'Ischia'],
  country: [['nazione', 'paese'], 'Italia'],
  first: [['nome', 'nome referente'], 'Mario'],
  last: [['cognome', 'cognome referente'], 'Rossi'],
  email: [['email', 'posta elettronica'], 'mario@alfa.it'],
  phone: [['telefono', 'cellulare'], '0815551234'],
  birth: [['data di nascita', 'nato il'], '01/02/1980'],
  emp: [['numero dipendenti', 'dipendenti'], '12'],
  msg: [['note', 'messaggio'], 'Richiesta di registrazione come fornitore.'],
  terms: [['termini e condizioni', 'accetto le condizioni'], true],
};
// secondo insieme di verifica, creato dopo le correzioni e mai usato per sceglierle
const TEST2 = {
  page: '/iscrizione.html',
  cases: {
    'Denominazione impresa': [['ragione sociale', 'nome azienda', 'company name'], 'Alfa Meccanica S.r.l.'],
    'C.F. / Partita IVA': [['partita iva', 'codice fiscale'], '01234567890'],
    'Forma giuridica': [['forma giuridica', 'tipo di societa'], 'S.r.l.'],
    'Numero REA': [['REA', 'numero REA'], 'NA-123456'],
    'Indirizzo della sede': [['indirizzo', 'sede legale', 'via'], 'Via Roma 1'],
    'Località': [['comune', 'citta'], 'Ischia'],
    'Codice di avviamento postale': [['cap', 'codice postale'], '80077'],
    'Indirizzo PEC': [['pec', 'posta certificata'], 'alfa@pec.it'],
    Nominativo: [['nome e cognome', 'referente'], 'Mario Rossi'],
    'Recapito telefonico': [['telefono', 'cellulare'], '0815551234'],
    'E-mail del referente': [['email', 'email referente'], 'mario@alfa.it'],
    'In qualità di': [['ruolo', 'qualifica'], 'Legale rappresentante'],
    'Data di nascita del referente': [['data di nascita', 'nato il'], '01/02/1980'],
    'Categoria merceologica': [['categoria', 'settore'], 'Formazione'],
    'Fatturato ultimo anno (€)': [['fatturato', 'ricavi'], '250000'],
    Annotazioni: [['note', 'messaggio'], 'Nessuna nota particolare da segnalare.'],
    'Acconsento al trattamento dei dati personali ai sensi del GDPR': [['privacy', 'consenso trattamento dati'], true],
  },
  none: [['codice ATECO', '62'], ['data inizio', '03/11/2026'], ['IBAN', 'IT60X0542811101000000123456'], ['numero dipendenti', '12'], ['provincia', 'Napoli']],
};
const TEST_NONE = [['PEC', 'alfa@pec.it'], ['codice ATECO', '62'], ['ore di formazione', '40'], ['data inizio', '03/11/2026'], ['provincia', 'Napoli'], ['IBAN', 'IT60X0542811101000000123456']];

const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
const S = new Session(loadConfig({ ...TEST_ENV, CB_PROFILE_DIR: TMP + '/prof-cal' }));
async function fieldsOf(url) {
  await S.open(url);
  const snap = await S.collect();
  return fieldsFrom(snap.items, snap.regions);
}
const keyOf = (f) => (f.kind === 'radio' ? 'radio:' + fold(f.name) : fold(f.name));
function cases(fields, spec, none, idOf) {
  const out = [];
  for (const [name, [keys, value]] of Object.entries(spec)) {
    const target = idOf(name);
    if (!target) throw new Error('campo non trovato nel modulo: ' + name);
    for (const k of keys) out.push({ logits: paramLogits({ key: k, value }, fields), target, label: `${k} -> ${name}` });
  }
  for (const [k, value] of none) out.push({ logits: paramLogits({ key: k, value }, fields), target: null, label: `${k} -> nessuno` });
  return out;
}
function probs(c, T, NONE) {
  const all = [...c.logits.map((o) => ({ key: o.key, l: o.logit })), { key: null, l: NONE }];
  const mx = Math.max(...all.map((o) => o.l));
  const ex = all.map((o) => Math.exp((o.l - mx) / T));
  const z = ex.reduce((a, b) => a + b, 0);
  return all.map((o, i) => ({ key: o.key, p: ex[i] / z })).sort((a, b) => b.p - a.p);
}
function evaluate(set, T, NONE, preset = PRESETS.balanced) {
  let nll = 0, correct = 0, acted = 0, actedOk = 0, asked = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, acc: 0 }));
  const wrong = [];
  for (const c of set) {
    const pr = probs(c, T, NONE);
    const pt = pr.find((x) => x.key === c.target)?.p ?? 1e-9;
    nll -= Math.log(Math.max(pt, 1e-9));
    const ok = pr[0].key === c.target;
    if (ok) correct++;
    else wrong.push(`${c.label}: scelto ${pr[0].key ?? 'nessuno'} ${Math.round(pr[0].p * 100)}%`);
    const b = bins[Math.min(9, Math.floor(pr[0].p * 10))];
    b.n++; b.conf += pr[0].p; b.acc += ok ? 1 : 0;
    const margin = pr[0].p - (pr[1] ? pr[1].p : 0);
    const act = pr[0].key !== null && (pr[0].p >= preset.act || (pr[0].p >= preset.escalate && margin >= preset.margin));
    if (act) { acted++; if (ok) actedOk++; } else asked++;
  }
  const ece = bins.reduce((a, b) => a + (b.n ? (b.n / set.length) * Math.abs(b.acc / b.n - b.conf / b.n) : 0), 0);
  return { n: set.length, nll: nll / set.length, acc: correct / set.length, ece, acted, actedOk, asked, wrong };
}

// insieme di addestramento: domanda1
const f1 = await fieldsOf(base + TRAIN.page);
const byName1 = (name) => (name === 'Ruolo' ? f1.find((f) => f.kind === 'radio') : f1.find((f) => f.kind === 'field' && fold(f.name) === fold(name)))?.id;
const train = cases(f1, TRAIN.cases, TRAIN.none, byName1);
// insieme di verifica: form.html in 4 lingue, chiavi in italiano
const test = [];
for (const lang of ['en', 'fr', 'es', 'de']) {
  const f = await fieldsOf(`${base}/form.html?lang=${lang}`);
  const snapIds = await S.collect();
  const byId = (id) => {
    const el = snapIds.items.find((i) => i.gx && i.gx.nm === id) || snapIds.items.find((i) => i.role === 'chk');
    return f.find((x) => x.id === el.id)?.id;
  };
  test.push(...cases(f, TEST_FIELDS, TEST_NONE, (name) => byId(name)).map((c) => ({ ...c, label: `[${lang}] ${c.label}` })));
}
// verifica 3: creata dopo tutte le correzioni, misurata una sola volta
const TEST3 = {
  page: '/registro.html',
  cases: {
    'Codice progetto': [['codice progetto', 'progetto'], 'PF-2026-115'],
    'Titolo corso': [['corso', 'titolo del corso'], 'Excel avanzato'],
    'Sede di svolgimento': [['sede', 'luogo'], 'Napoli, via Toledo 1'],
    'Data della lezione': [['data', 'giorno della lezione'], '12/11/2026'],
    'Ora inizio (hh:mm)': [['dalle ore', 'ora inizio'], '09:00'],
    'Ora fine (hh:mm)': [['alle ore', 'ora fine'], '13:00'],
    Docente: [['docente', 'formatore'], 'Anna Bianchi'],
    'Numero partecipanti presenti': [['presenti', 'partecipanti'], '9'],
    'Modalità': [['modalita', 'erogazione'], 'Aula'],
    'Argomenti trattati': [['argomenti', 'contenuti della lezione'], 'Tabelle pivot, funzioni di ricerca e grafici dinamici.'],
    'Allegato registro presenze': [['registro presenze', 'foglio firme'], 'C:\\documenti\\registro.pdf'],
    'Confermo la correttezza dei dati inseriti': [['conferma dati', 'dichiarazione di correttezza'], true],
  },
  none: [['partita iva', '01234567890'], ['email', 'mario@alfa.it'], ['IBAN', 'IT60X0542811101000000123456'], ['comune', 'Ischia'], ['ragione sociale', 'Alfa Meccanica S.r.l.']],
};
const f4 = await fieldsOf(base + TEST3.page);
const test3 = cases(f4, TEST3.cases, TEST3.none, (name) => f4.find((f) => f.kind === 'field' && fold(f.texts[0]) === fold(name))?.id);
const f3 = await fieldsOf(base + TEST2.page);
const test2 = cases(f3, TEST2.cases, TEST2.none, (name) => f3.find((f) => f.kind === 'field' && fold(f.full || f.name).startsWith(fold(name).slice(0, 25)))?.id || f3.find((f) => f.kind === 'field' && fold(f.texts[0]).startsWith(fold(name).slice(0, 25)))?.id);
await S.close();
srv.close();

// stima di T e NONE su addestramento + verifica 1 con "label smoothing" (eps 0.05): con pochi dati quasi separabili
// la sola log-verosimiglianza spinge T verso 0 e rende le probabilita' troppo sicure (verificato sulla verifica 2)
function smoothedNll(set, T, NONE, EPS) {
  let tot = 0;
  for (const c of set) {
    const pr = probs(c, T, NONE);
    const K = pr.length;
    for (const x of pr) tot -= ((x.key === c.target ? 1 - EPS : 0) + EPS / K) * Math.log(Math.max(x.p, 1e-12));
  }
  return tot / set.length;
}
const fitSet = [...train, ...test];
let best = null;
// la forza dello smoothing si sceglie con l'errore di calibrazione sugli insiemi gia' usati (mai sulla verifica 3)
for (const EPS of [0.01, 0.02, 0.03, 0.05]) {
  let b = null;
  for (let T = 0.2; T <= 3.001; T += 0.05) for (let NONE = 0; NONE <= 9.001; NONE += 0.1) {
    const nll = smoothedNll(fitSet, T, NONE, EPS);
    if (!b || nll < b.nll) b = { T: +T.toFixed(2), NONE: +NONE.toFixed(1), nll, EPS };
  }
  b.ece = evaluate(fitSet, b.T, b.NONE).ece;
  console.log(`  eps ${EPS}: T ${b.T}, NONE ${b.NONE}, ECE addestramento+verifica1 ${b.ece.toFixed(3)}`);
  if (!best || b.ece < best.ece) best = b;
}
const tr = evaluate(train, best.T, best.NONE);
const te = evaluate(test, best.T, best.NONE);
const pct = (x) => (x * 100).toFixed(1) + '%';
const rep = (name, r) => `${name}: ${r.n} casi · accuratezza ${pct(r.acc)} · ECE ${r.ece.toFixed(3)} · eseguiti da solo ${r.acted} (${pct(r.acted / r.n)}) con precisione ${r.acted ? pct(r.actedOk / r.acted) : '-'} · chiesti a Claude ${r.asked}`;
console.log(`scelto: eps ${best.EPS}, T = ${best.T}, NONE = ${best.NONE}`);
console.log(rep('addestramento (modulo italiano)', tr));
console.log(rep('verifica 1 (modulo en/fr/es/de; usato per la temperatura)', te));
const te2 = evaluate(test2, best.T, best.NONE);
const te3 = evaluate(test3, best.T, best.NONE);
console.log(rep('verifica 2 (modulo italiano diverso; errori visti, usati per correggere)', te2));
console.log('errori in verifica:\n  ' + (te.wrong.join('\n  ') || 'nessuno'));
console.log(rep('verifica 3 (modulo nuovo, misurato una sola volta)', te3));
console.log('errori in verifica 2:\n  ' + (te2.wrong.join('\n  ') || 'nessuno'));
console.log('errori in verifica 3:\n  ' + (te3.wrong.join('\n  ') || 'nessuno'));
console.log('errori in addestramento:\n  ' + (tr.wrong.join('\n  ') || 'nessuno'));
fs.writeFileSync(path.join(TMP, 'calibration.json'), JSON.stringify({ EPS: best.EPS, T: best.T, NONE: best.NONE, train: tr, test: te, test2: te2, test3: te3 }, null, 1));
