// Test funzionali end-to-end via protocollo MCP reale.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

const SCR = TMP;
fs.mkdirSync(SCR, { recursive: true });
const DL = path.join(SCR, 'dl-func');
fs.rmSync(DL, { recursive: true, force: true });
fs.rmSync(path.join(SCR, 'prof-func'), { recursive: true, force: true });
const PDF = path.join(SCR, 'visura.pdf');
fs.writeFileSync(PDF, '%PDF-1.4\n% visura demo\n');

const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
let pass = 0;
let fail = 0;
const log = [];
function ok(cond, name, detail = '') {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 1500) : ''}`);
}
const has = (t, s) => t.includes(s);
const ref = (text, re) => {
  const m = text.match(re);
  return m ? m[1] : null;
};

const c = await connect({ CB_PROFILE_DIR: path.join(SCR, 'prof-func'), CB_DOWNLOADS_DIR: DL });

// ---------- 1. modulo multipagina ----------
let r = await c.call('browse_open', { url: base + '/domanda1.html' });
ok(!r.isError && has(r.text, 'text "Ragione sociale" req'), 'apertura modulo e vista compatta', r.text);
ok(has(r.text, 'combo "Comune"'), 'autocompletamento riconosciuto come combo');
ok(has(r.text, 'btn "Avanti"') && !has(r.text, 'btn "Avanti" !c'), '"Avanti" non marcato come sensibile');
ok(has(r.text, 'btn "Salva bozza" !c'), '"Salva bozza" marcato !c');

r = await c.call('browse_do', {
  steps: [
    { fill: 'Ragione sociale', text: 'Alfa Meccanica S.r.l.' },
    { fill: 'Partita IVA', text: '01234567890' },
    { fill: 'Codice fiscale azienda', text: '01234567890' },
    { select: 'Codice ATECO', option: '62' },
    { select: 'Regione', option: 'Campania' },
    { select: 'Provincia', option: 'Napoli' },
    { type: 'Comune', text: 'Isch' },
    { pick: 'Ischia' },
    { fill: 'Indirizzo sede legale', text: 'Via Roma 1' },
    { fill: 'CAP', text: '800770' },
    { fill: 'PEC', text: 'alfa@pec.it' },
    { fill: 'Nome', text: 'Mario' },
    { fill: 'Cognome', text: 'Rossi' },
    { fill: 'Email', text: 'mario@alfa.it' },
    { check: 'Legale rappresentante' },
    { fill: 'Titolo del piano', text: 'Competenze digitali 2026' },
    { select: 'Fonte di finanziamento', option: 'Nuove Competenze' },
    { fill: 'Numero dipendenti coinvolti', text: '12' },
    { fill: 'Ore di formazione', text: '40' },
    { fill: 'Data inizio', text: '2026-11-03' },
    { fill: 'Data fine', text: '15/12/2026' },
    { fill: 'Descrizione degli obiettivi', text: 'Sviluppare competenze digitali di base per 12 dipendenti.' },
    { check: 'Dichiaro di aver letto' },
  ],
});
ok(has(r.text, 'ok 22/23') && has(r.text, 'BLOCCATO') && has(r.text, 'confirm'), 'batch 23 passi: 22 eseguiti, privacy bloccata', r.text);
ok(has(r.text, 'valore ora "80077"'), 'verifica valore dopo fill (maxlength)', r.text);
ok(has(r.text, '"Provincia" ="Napoli"') && has(r.text, '"Comune" ="Ischia"'), 'select dipendente e autocompletamento riusciti', r.text);
ok(has(r.text, '16 campi impostati come richiesto') && !has(r.text, '"Ragione sociale" ='), 'valori scritti come richiesto non ripetuti nel diff', r.text);
ok(!has(r.text, 'pagina cambiata'), 'risposta in forma di diff', r.text);

r = await c.call('browse_do', {
  steps: [
    { check: 'Dichiaro di aver letto', confirm: true },
    { check: 'Dichiaro che i dati', confirm: true },
    { upload: 'Visura camerale', file: PDF },
  ],
});
ok(has(r.text, 'ok 2/3') && has(r.text, '!c caricamento di'), 'upload bloccato senza confirm', r.text);
r = await c.call('browse_do', { steps: [{ upload: 'Visura camerale', file: PDF, confirm: true }, { click: 'Avanti' }] });
ok(has(r.text, 'ok 2/2') && has(r.text, 'pagina cambiata') && has(r.text, 'domanda2.html'), 'upload + Avanti: navigazione a pagina 2 (ritardata 200 ms)', r.text);
r = await c.call('browse_read', { mode: 'table' });
ok(has(r.text, 'ragione_sociale\tAlfa Meccanica S.r.l.') && has(r.text, 'comune\tIschia') && has(r.text, 'provincia\tNapoli'), 'riepilogo coerente con i dati inseriti', r.text);

// ---------- 2. invio con modale e download ----------
r = await c.call('browse_do', { steps: [{ click: 'Invia domanda' }] });
ok(has(r.text, 'ok 0/1') && has(r.text, 'BLOCCATO'), '"Invia domanda" bloccato senza confirm', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Invia domanda', confirm: true }] });
ok(has(r.text, '[MODALE "Conferma invio"]') && has(r.text, 'btn "Conferma invio" !c') && !has(r.text, 'Modifica dati'), 'modale: mostrati solo i suoi elementi', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Annulla' }] });
ok(!has(r.text, 'MODALE') && has(r.text, 'Invia domanda'), 'chiusura modale con Annulla', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Invia domanda', confirm: true }, { click: 'Conferma invio', confirm: true }, { click: 'Scarica ricevuta' }] });
ok(has(r.text, 'ok 3/3') && has(r.text, 'Protocollo n. 2026/004512') && has(r.text, 'download salvato'), 'invio confermato, protocollo letto, ricevuta scaricata', r.text);
ok(fs.existsSync(DL) && fs.readdirSync(DL).some((f) => /^ricevuta.*\.pdf$/.test(f)), 'file ricevuta presente su disco', fs.existsSync(DL) ? fs.readdirSync(DL) : 'nessuna cartella');

// ---------- 3. elenco, filtri, ambiguita', ref sicuri ----------
r = await c.call('browse_open', { url: base + '/elenco.html' });
const firstView = ref(r.text, /(e\d+) link "Visualizza"/);
ok(has(r.text, '@"PF-2026-101 · Competenze digitali di base'), 'righe tabella raggruppate con contesto', r.text);
r = await c.call('browse_do', { steps: [{ fill: 'Cerca per titolo o azienda', text: 'Excel' }, { click: 'Cerca' }] });
ok(has(r.text, 'ok 2/2'), 'filtro eseguito (Cerca del filtro scelto rispetto a quello nascosto nell\'header)', r.text);
ok(!has(r.text, 'BLOCCATO'), '"Cerca" in form di ricerca non bloccato', r.text);
r = await c.call('browse_view', {});
ok(has(r.text, 'PF-2026-107') && has(r.text, 'PF-2026-115') && !has(r.text, 'PF-2026-101'), 'tabella filtrata (3 righe Excel)', r.text);
r = await c.call('browse_do', { steps: [{ click: firstView }] });
ok(has(r.text, 'ok 0/1') && has(r.text, 'scaduto'), `ref vecchio (${firstView}) dopo ridisegno tabella rifiutato, non riassegnato a un'altra riga`, r.text);
r = await c.call('browse_do', { steps: [{ click: 'Visualizza' }] });
ok(has(r.text, 'ambiguo (3)'), 'target ambiguo segnalato con candidati', r.text);
r = await c.call('browse_do', { steps: [{ click: { name: 'Visualizza', n: 2 } }] });
ok(has(r.text, 'dettaglio.html?c=PF-2026-115'), 'scelta n-esima: apre PF-2026-115', r.text);
r = await c.call('browse_read', { mode: 'table' });
ok(has(r.text, 'righe 1-7 di 7') && has(r.text, 'Ed. 6'), 'lettura tabella edizioni', r.text);
r = await c.call('browse_do', { steps: [{ back: true }, { click: { name: 'Visualizza', row: 'PF-2026-123' } }, { read: 'table', max: 3 }, { find: 'Scadenza' }] });
ok(has(r.text, 'tabella:\nrighe 1-3 di 7') && has(r.text, 'Scadenza rendicontazione'), 'passi read/find nello stesso blocco', r.text);
ok(has(r.text, 'ok 4/4') && has(r.text, 'c=PF-2026-123'), 'target per riga: {name, row} dopo un cambio pagina nello stesso blocco', r.text);
r = await c.call('browse_do', { steps: [{ back: true }] });
ok(has(r.text, 'elenco.html'), 'indietro', r.text);
r = await c.call('browse_view', { filter: 'PF-2026-102' });
const del102 = ref(r.text, /(e\d+) btn "Elimina"/);
r = await c.call('browse_do', { steps: [{ click: del102, confirm: true }] });
ok(has(r.text, 'finestra confirm') && has(r.text, 'annullata'), 'confirm() nativo annullato per default', r.text);
r = await c.call('browse_do', { steps: [{ dialog: 'accept' }] });
ok(has(r.text, 'BLOCCATO'), 'accettare finestra richiede confirm', r.text);
r = await c.call('browse_do', { steps: [{ dialog: 'accept', confirm: true }, { click: del102, confirm: true }] });
ok(has(r.text, 'accettata') && /\n- .*e\d+/.test(r.text), 'eliminazione con conferma esplicita: riga rimossa nel diff', r.text);

// ---------- 4. ref non riutilizzabili tra pagine ----------
r = await c.call('browse_open', { url: base + '/index.html' });
const elencoLink = ref(r.text, /(e\d+) link "Elenco progetti"/);
const leggi = ref(r.text, /(e\d+) link "Leggi di più"/);
r = await c.call('browse_do', { steps: [{ click: elencoLink }, { click: leggi }] });
ok(has(r.text, 'ok 1/2') && has(r.text, 'scaduto'), 'ref della pagina precedente rifiutato dopo navigazione', r.text);

// ---------- 5. casi limite ----------
r = await c.call('browse_open', { url: base + '/test.html' });
ok(has(r.text, 'CAPTCHA'), 'captcha rilevato');
ok(has(r.text, '! Attenzione: sessione in scadenza'), 'avviso role=alert riportato');
ok(has(r.text, 'f1') && has(r.text, 'Nome nel frame'), 'elementi dentro iframe');
ok(has(r.text, 'Campo nello shadow'), 'elementi dentro shadow DOM');
r = await c.call('browse_do', { steps: [{ fill: 'Numero carta', text: '4111111111111111' }] });
ok(has(r.text, 'BLOCCATO') && has(r.text, 'campo riservato'), 'numero carta mai compilabile', r.text);
r = await c.call('browse_do', { steps: [{ fill: 'IBAN', text: 'IT60X0542811101000000123456', confirm: true }] });
ok(has(r.text, 'BLOCCATO'), 'IBAN bloccato anche con confirm', r.text);
r = await c.call('browse_do', {
  steps: [
    { fill: 'Codice fiscale', text: 'RSSMRA80A01F839X' },
    { check: 'Ricevi la newsletter' },
    { fill: 'Campo nello shadow', text: 'ombra' },
    { click: 'Ok shadow' },
    { fill: 'Nome nel frame', text: 'Mario' },
    { click: 'Applica nel frame' },
    { click: 'Pulsante custom' },
    { fill: 'Note libere', text: 'nota di prova' },
    { select: 'Comune di nascita', option: 'Comune 087' },
    { click: 'Pulsante in fondo' },
  ],
});
ok(has(r.text, 'ok 10/10'), 'batch casi limite completo', r.text);
ok(has(r.text, '5 campi impostati come richiesto') && !has(r.text, 'ancora'), 'checkbox nascosta con label spuntata (verificata dal server)', r.text);
ok(has(r.text, '="Comune 087"') && has(r.text, '"cliccato"') && has(r.text, '"fondo ok"'), 'select lunga, pulsante custom, elemento fuori schermo', r.text);
r = await c.call('browse_view', { filter: 'Note libere' });
ok(has(r.text, '="nota di prova"'), 'contenteditable compilato', r.text);
r = await c.call('browse_view', { filter: 'newsletter' });
ok(has(r.text, '[x]'), 'checkbox nascosta risulta spuntata', r.text);
r = await c.call('browse_read', { mode: 'find', query: 'frame ok' });
ok(has(r.text, 'frame ok: Mario'), 'azione dentro iframe eseguita', r.text);
r = await c.call('browse_read', { mode: 'find', query: 'fondo ok' });
ok(has(r.text, 'fondo ok'), 'clic su elemento fuori schermo (scroll automatico)', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Cancella elemento' }] });
ok(has(r.text, 'BLOCCATO'), '"Cancella elemento" richiede conferma', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Apri guida in nuova scheda' }, { click: 'Ho letto' }] });
ok(has(r.text, 'ok 2/2') && has(r.text, 'nuova scheda') && has(r.text, 'popup.html') && has(r.text, 'schede 2'), 'nuova scheda: passaggio automatico e azione nella scheda', r.text);
r = await c.call('browse_do', { steps: [{ tab: 'close' }] });
ok(has(r.text, 'test.html'), 'chiusura scheda e ritorno alla precedente', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Scarica modulo' }] });
ok(has(r.text, 'download salvato'), 'download da link con attributo download', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Link a dominio esterno' }] });
ok(has(r.text, 'localhost') || has(r.text, 'errore'), 'senza whitelist la navigazione esterna e\' consentita', r.text);
r = await c.call('browse_open', { url: base + '/login.html' });
ok(has(r.text, 'campo password') && has(r.text, 'pwd "Password" !x'), 'pagina di login: password riservata all\'utente', r.text);
r = await c.call('browse_do', { steps: [{ fill: 'Password', text: 'segreta' }] });
ok(has(r.text, 'BLOCCATO'), 'password mai compilabile', r.text);
r = await c.call('browse_do', { steps: [{ fill: 'Codice fiscale', text: 'RSSMRA80A01F839X' }, { press: 'Enter', target: 'Codice fiscale' }] });
ok(has(r.text, 'ok 1/2') && has(r.text, 'Enter invia il modulo'), 'Enter che invia un modulo richiede conferma', r.text);
r = await c.call('browse_open', { url: base + '/elenco.html' });
r = await c.call('browse_do', { steps: [{ fill: 'Cerca per titolo o azienda', text: 'Lean' }, { press: 'Enter' }] });
ok(has(r.text, 'ok 2/2'), 'Enter in campo di ricerca consentito', r.text);
r = await c.call('browse_open', { url: 'file:///etc/passwd' });
ok(r.isError && has(r.text, 'non consentito'), 'file:// bloccato', r.text);
r = await c.call('browse_do', { steps: [{ goto: 'javascript:alert(1)' }] });
ok(has(r.text, 'non consentito'), 'javascript: bloccato', r.text);
r = await c.call('browse_screenshot', {});
ok(!r.isError && r.image && /~\d+ token/.test(r.text), 'screenshot ridotto con stima token', r.text);
r = await c.call('browse_stats', {});
ok(has(r.text, 'risparmio stimato'), 'statistiche di sessione', r.text);
console.log('\n--- stats ---\n' + r.text);
fs.writeFileSync(path.join(SCR, 'func-calls.json'), JSON.stringify(c.calls, null, 1));
await c.close();

// ---------- 6. whitelist domini ----------
const w = await connect({ CB_PROFILE_DIR: path.join(SCR, 'prof-func2'), CB_ALLOWED_DOMAINS: '127.0.0.1' });
r = await w.call('browse_open', { url: base + '/test.html' });
ok(!r.isError, 'whitelist: dominio consentito apribile', r.text);
r = await w.call('browse_open', { url: base.replace('127.0.0.1', 'localhost') + '/index.html' });
ok(r.isError && has(r.text, 'non e\' tra i domini consentiti'), 'whitelist: dominio esterno rifiutato', r.text);
r = await w.call('browse_do', { steps: [{ click: 'Link a dominio esterno' }, { click: 'Elenco progetti' }] });
ok(has(r.text, 'fuori dai domini consentiti') || has(r.text, 'errore'), 'whitelist: azioni bloccate fuori dominio dopo un link', r.text);
await w.close();

// ---------- 7. casi portale ----------
const x = await connect({ CB_PROFILE_DIR: path.join(SCR, 'prof-func3') });
r = await x.call('browse_open', { url: base + '/extra.html' });
ok(has(r.text, 'text "Data protocollo" ro'), 'campo in sola lettura riconosciuto', r.text.slice(0, 600));
ok(has(r.text, 'altre 2990 righe') && !has(r.text, 'altri 2') && r.text.length < 2500, `DOM con 3000 righe: vista troncata (${r.text.length} caratteri, ${Math.round(r.ms)} ms)`, r.text.slice(-300));
r = await x.call('browse_do', { steps: [{ fill: 'Data protocollo', text: '28/10/2026' }] });
ok(has(r.text, 'sola lettura') && has(r.text, 'ok 1/1'), 'datepicker in sola lettura: valore impostato via script', r.text);
r = await x.call('browse_read', { mode: 'find', query: 'data ricevuta' });
ok(has(r.text, 'data ricevuta: 28/10/2026'), 'evento change ricevuto dalla pagina', r.text);
r = await x.call('browse_do', { steps: [{ click: 'Pulsante coperto' }] });
ok(has(r.text, 'coperto da') && has(r.text, 'force'), 'overlay che intercetta il clic segnalato', r.text);
r = await x.call('browse_do', { steps: [{ click: 'Pulsante coperto', force: true }] });
ok(has(r.text, 'ok 1/1'), 'clic forzato via script', r.text);
r = await x.call('browse_do', { steps: [{ click: 'Pulsante disattivato' }] });
ok(has(r.text, 'disattivato') && r.ms < 1500, `pulsante disattivato: errore immediato (${Math.round(r.ms)} ms)`, r.text);
r = await x.call('browse_do', { steps: [{ click: 'Carica dati lenti' }] });
ok(has(r.text, 'dati arrivati'), `attesa AJAX lenta 2,5 s inclusa nel passo (${Math.round(r.ms)} ms)`, r.text);
r = await x.call('browse_do', { steps: [{ click: 'Procedi lento' }, { click: 'Ho letto' }] });
ok(has(r.text, 'ok 2/2') && has(r.text, 'popup.html'), `navigazione dopo AJAX lenta, passo successivo sulla nuova pagina (${Math.round(r.ms)} ms)`, r.text);
r = await x.call('browse_view', { filter: 'Doc 2999' });
ok(has(r.text, 'nessun elemento') || has(r.text, 'Apri'), 'filtro su vista grande');
await x.close();

srv.close();
console.log(log.join('\n'));
console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
