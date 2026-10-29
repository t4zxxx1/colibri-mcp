// Calibrazione del motore decisionale: come Jev chiede probabilita' "oneste", qui si stimano temperatura (T)
// e punteggio dell'opzione "nessuno" (NONE) minimizzando la log-verosimiglianza su casi etichettati.
// Addestramento: modulo italiano (domanda1). Verifica: modulo di registrazione in 4 lingue (form.html), mai usato per stimare.
import fs from 'node:fs';
import path from 'node:path';
import { Session, loadConfig } from '../extension/server/lib/session.js';
import * as engine from '../extension/server/lib/engine.js';
const { fieldsFrom, paramLogits, fold, PRESETS, assign, resetCaches } = engine;
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
// verifica 4: dominio nuovo (trasferte), nomi tecnici dei campi (fld_01...), scritta prima delle modifiche della v0.4
// e misurata una volta prima e una dopo, senza correzioni guardando i suoi errori
const TEST4 = {
  page: '/rimborso.html',
  cases: {
    Matricola: [['matricola', 'numero di matricola'], 'A10234'],
    'Cognome e nome': [['nominativo', 'dipendente'], 'Rossi Mario'],
    'Ufficio di appartenenza': [['ufficio', 'servizio'], 'Ragioneria'],
    'Recapito telefonico': [['telefono', 'cellulare'], '3331234567'],
    Destinazione: [['destinazione', 'luogo della missione'], 'Roma'],
    'Motivo della missione': [['motivo', 'finalita della trasferta'], 'Partecipazione al convegno nazionale sulla contabilita pubblica.'],
    'Data partenza': [['data partenza', 'giorno di partenza'], '14/11/2026'],
    'Ora partenza': [['ora partenza', 'orario di partenza'], '07:30'],
    'Data rientro': [['data rientro', 'data di ritorno'], '15/11/2026'],
    'Ora rientro': [['ora rientro', 'orario di ritorno'], '21:10'],
    'Mezzo di trasporto': [['mezzo di trasporto', 'mezzo'], 'Treno'],
    'Chilometri percorsi': [['chilometri', 'km percorsi'], '320'],
    'Importo totale richiesto (€)': [['importo', 'totale da rimborsare'], '184,50'],
    'Giustificativi di spesa': [['giustificativi', 'ricevute'], 'C:\\documenti\\ricevute.pdf'],
    'Dichiaro che le spese sono state effettivamente sostenute': [['dichiarazione spese', 'spese sostenute'], true],
  },
  none: [['codice fiscale', 'RSSMRA80A01H501U'], ['IBAN', 'IT60X0542811101000000123456'], ['email', 'mario.rossi@ente.it'], ['data di nascita', '01/01/1980'], ['partita iva', '01234567890']],
};
// verifica 5: scritta dopo le modifiche al motore della v0.4 e prima del nuovo vocabolario; misurata una sola volta
const TEST5 = {
  page: '/intervento.html',
  cases: {
    'Codice cliente': [['codice cliente', 'numero cliente'], 'CL-88231'],
    'Persona da contattare': [['referente', 'nome del contatto'], 'Giulia Verdi'],
    'Indirizzo e-mail': [['email', 'posta elettronica'], 'giulia.verdi@example.it'],
    'Numero di cellulare': [['cellulare', 'telefono'], '3409876543'],
    'Via e numero civico': [['indirizzo', 'via'], 'Via Roma 12'],
    Comune: [['citta', 'comune'], 'Salerno'],
    CAP: [['cap', 'codice postale'], '84121'],
    'Tipo di guasto': [['tipo di guasto', 'categoria del problema'], 'Idraulico'],
    'Descrivi il problema': [['descrizione', 'dettagli del problema'], 'Perdita d acqua sotto il lavello della cucina da due giorni.'],
    'Fotografia del guasto': [['foto', 'immagine del guasto'], 'C:\\foto\\lavello.jpg'],
    'Giorno preferito': [['data appuntamento', 'giorno'], '20/11/2026'],
    'Fascia oraria': [['fascia oraria', 'fascia'], 'Mattina'],
    'Orario di arrivo desiderato': [['ora di arrivo', 'orario preferito'], '10:30'],
    'Accetto le condizioni del servizio di assistenza': [['condizioni', 'accettazione condizioni'], true],
  },
  none: [['partita iva', '01234567890'], ['data di nascita', '05/05/1985'], ['IBAN', 'IT60X0542811101000000123456'], ['ragione sociale', 'Beta S.r.l.'], ['provincia', 'Salerno']],
};

const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
const S = new Session(loadConfig({ ...TEST_ENV, CB_PROFILE_DIR: TMP + '/prof-cal' }));
async function fieldsOf(url) {
  await S.open(url);
  const snap = await S.collect();
  return fieldsFrom(snap.items, snap.regions);
}
const keyOf = (f) => (f.kind === 'radio' ? 'radio:' + fold(f.name) : fold(f.name));
function cases(fields, spec, none, idOf, page = '') {
  const out = [];
  for (const [name, [keys, value]] of Object.entries(spec)) {
    const target = idOf(name);
    if (!target) throw new Error('campo non trovato nel modulo: ' + name);
    keys.forEach((k, vi) => out.push({ logits: paramLogits({ key: k, value }, fields), target, label: `${k} -> ${name}`, param: { key: k, value }, fields, page, field: name, vi, nv: keys.length }));
  }
  for (const [k, value] of none) out.push({ logits: paramLogits({ key: k, value }, fields), target: null, label: `${k} -> nessuno`, param: { key: k, value }, fields, page, field: null, vi: 0, nv: 0 });
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
const train = cases(f1, TRAIN.cases, TRAIN.none, byName1, 'domanda1');
// insieme di verifica: form.html in 4 lingue, chiavi in italiano
const test = [];
for (const lang of ['en', 'fr', 'es', 'de']) {
  const f = await fieldsOf(`${base}/form.html?lang=${lang}`);
  const snapIds = await S.collect();
  const byId = (id) => {
    const el = snapIds.items.find((i) => i.gx && i.gx.nm === id) || snapIds.items.find((i) => i.role === 'chk');
    return f.find((x) => x.id === el.id)?.id;
  };
  test.push(...cases(f, TEST_FIELDS, TEST_NONE, (name) => byId(name), 'form-' + lang).map((c) => ({ ...c, label: `[${lang}] ${c.label}` })));
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
const test3 = cases(f4, TEST3.cases, TEST3.none, (name) => f4.find((f) => f.kind === 'field' && fold(f.texts[0]) === fold(name))?.id, 'registro');
const f3 = await fieldsOf(base + TEST2.page);
const test2 = cases(f3, TEST2.cases, TEST2.none, (name) => f3.find((f) => f.kind === 'field' && fold(f.full || f.name).startsWith(fold(name).slice(0, 25)))?.id || f3.find((f) => f.kind === 'field' && fold(f.texts[0]).startsWith(fold(name).slice(0, 25)))?.id, 'iscrizione');
const f5 = await fieldsOf(base + TEST4.page);
const test4 = cases(f5, TEST4.cases, TEST4.none, (name) => (name === 'Mezzo di trasporto' ? f5.find((f) => f.kind === 'radio') : f5.find((f) => f.kind === 'field' && fold(f.texts[0]) === fold(name)))?.id, 'rimborso');
const f6 = await fieldsOf(base + TEST5.page);
const test5 = cases(f6, TEST5.cases, TEST5.none, (name) => (name === 'Fascia oraria' ? f6.find((f) => f.kind === 'radio') : f6.find((f) => f.kind === 'field' && fold(f.texts[0]) === fold(name)))?.id, 'intervento');
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
const te4 = evaluate(test4, best.T, best.NONE);
console.log(rep('verifica 4 (dominio nuovo, nomi dei campi tecnici)', te4));
console.log('errori in verifica 4:\n  ' + (te4.wrong.join('\n  ') || 'nessuno'));

// metriche nello stile di System One Bench: ECE, AUROC della confidenza, copertura e precisione delle azioni autonome
function extra(set) {
  const rows = set.map((c) => { const pr = probs(c, best.T, best.NONE); return { conf: pr[0].p, ok: pr[0].key === c.target }; });
  const pos = rows.filter((r) => r.ok), neg = rows.filter((r) => !r.ok);
  let au = 0;
  for (const p of pos) for (const q of neg) au += p.conf > q.conf ? 1 : p.conf === q.conf ? 0.5 : 0;
  return { auroc: pos.length && neg.length ? au / (pos.length * neg.length) : null };
}
// compito intero: tutti i parametri di un modulo insieme (una variante per ogni sinonimo), con la stessa
// assegnazione usata da browse_task. Conta campi compilati bene, sbagliati e domande a Claude.
function taskSim(set) {
  const byPage = new Map();
  for (const c of set) { if (!byPage.has(c.page)) byPage.set(c.page, []); byPage.get(c.page).push(c); }
  const t = { tasks: 0, params: 0, ok: 0, wrong: 0, asked: 0, noneAsked: 0, noneActed: 0, wrongList: [] };
  for (const [, cs] of byPage) {
    const withTarget = cs.filter((c) => c.target);
    const nones = cs.filter((c) => !c.target);
    const nVar = Math.max(1, ...withTarget.map((c) => c.nv));
    for (let j = 0; j < nVar; j++) {
      const pick = withTarget.filter((c) => c.vi === j % c.nv);
      const all = [...pick, ...nones];
      if (resetCaches) resetCaches();
      const t0 = process.hrtime.bigint();
      const { acts } = assign(all.map((c) => c.param), cs[0].fields);
      t.ms = (t.ms || 0) + Number(process.hrtime.bigint() - t0) / 1e6;
      const actOf = new Map(acts.map((a) => [a.p, a.f.id]));
      t.tasks++;
      for (const c of all) {
        const got = actOf.get(c.param);
        if (!c.target) { if (got) { t.noneActed++; t.wrongList.push(`${c.label}: compilato ${got}`); } else t.noneAsked++; continue; }
        t.params++;
        if (got === c.target) t.ok++;
        else if (got) { t.wrong++; t.wrongList.push(`${c.label}: compilato ${got}`); } else t.asked++;
      }
    }
  }
  return t;
}
const sets = { train, test, test2, test3, test4 };
const out = { EPS: best.EPS, T: best.T, NONE: best.NONE, train: tr, test: te, test2: te2, test3: te3, test4: te4 };
// la verifica 5 si guarda solo alla fine (VERIFY5=1), per non correggere il motore sui suoi errori
if (process.env.VERIFY5) {
  const te5 = evaluate(test5, best.T, best.NONE);
  console.log(rep('verifica 5 (dominio nuovo, misurata una sola volta)', te5));
  console.log('errori in verifica 5:\n  ' + (te5.wrong.join('\n  ') || 'nessuno'));
  sets.test5 = test5;
  out.test5 = te5;
}
console.log('\ncompito intero (preset balanced):');
for (const [k, s] of Object.entries(sets)) {
  const t = taskSim(s);
  Object.assign(out[k], extra(s), { task: t });
  console.log(`  ${k.padEnd(6)} ${t.tasks} compiti · ${t.params} campi: ${t.ok} compilati da solo (${pct(t.ok / t.params)}), ${t.asked} chiesti, ${t.wrong} sbagliati · parametri senza campo: ${t.noneAsked} segnalati, ${t.noneActed} compilati per errore · ${(t.ms / t.tasks).toFixed(1)} ms a compito`);
  for (const w of t.wrongList) console.log('    ✗ ' + w);
}
// riepilogo su tutti i casi, con le stesse metriche di System One Bench (accuratezza, ECE, AUROC, latenza)
{
  const all = Object.values(sets).flat();
  const ev = evaluate(all, best.T, best.NONE);
  const lat = [];
  for (let rep3 = 0; rep3 < 3; rep3++) for (const c of all) {
    if (resetCaches) resetCaches();
    const t0 = process.hrtime.bigint();
    paramLogits(c.param, c.fields);
    lat.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  lat.sort((a, b) => a - b);
  const q = (x) => lat[Math.min(lat.length - 1, Math.floor(x * lat.length))];
  out.overall = { n: ev.n, acc: ev.acc, ece: ev.ece, auroc: extra(all).auroc, coverage: ev.acted / ev.n, precision: ev.actedOk / ev.acted, p50ms: q(0.5), p95ms: q(0.95) };
  const o = out.overall;
  console.log(`\ntutti i casi: ${o.n} · accuratezza ${pct(o.acc)} · ECE ${pct(o.ece)} · AUROC ${o.auroc.toFixed(2)} · eseguiti da solo ${pct(o.coverage)} con precisione ${pct(o.precision)} · latenza p50 ${o.p50ms.toFixed(2)} ms, p95 ${o.p95ms.toFixed(2)} ms`);
}
fs.writeFileSync(path.join(TMP, 'calibration.json'), JSON.stringify(out, null, 1));
