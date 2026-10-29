// Test delle novita' 0.2: motore decisionale (browse_task), sicurezza, memoria per sito, estrazione,
// multilingue, coordinate stile "box", icone, etichette, scelta per somiglianza.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
for (const d of ['prof-v2', 'prof-v2b', 'prof-v2c']) fs.rmSync(path.join(TMP, d), { recursive: true, force: true });
fs.rmSync(path.join(TMP, 'site-memory.json'), { force: true });
const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
let pass = 0;
let fail = 0;
const log = [];
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 1600) : ''}`);
};
const has = (t, s) => t.includes(s);
const c = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-v2') });

// ---------- 1. compito guidato sul modulo, senza vedere la pagina ----------
let r = await c.call('browse_task', {
  url: base + '/domanda1.html',
  params: {
    'ragione sociale': 'Alfa Meccanica S.r.l.', 'P.IVA': '01234567890', 'codice fiscale': '01234567890', ateco: '62', regione: 'Campania', provincia: 'Napoli',
    comune: 'Ischia', indirizzo: 'Via Roma 1', cap: '80077', pec: 'alfa@pec.it', nome: 'Mario', cognome: 'Rossi', email: 'mario@alfa.it', ruolo: 'Legale rappresentante',
    'titolo del piano': 'Competenze digitali 2026', fondo: 'Fondo Nuove Competenze', 'numero dipendenti': 12, ore: 40, 'data inizio': '03/11/2026', 'data fine': '2026-12-15',
    obiettivi: 'Sviluppare competenze digitali di base per 12 dipendenti.',
  },
});
ok(has(r.text, 'parametri: 21/21 impostati') && !has(r.text, '? "'), 'browse_task: 21/21 parametri abbinati e impostati senza domande', r.text);
ok(has(r.text, 'data adattata: 2026-11-03'), 'data adattata al campo data nativo (AAAA-MM-GG)', r.text);
ok(has(r.text, 'pulsanti: ') && has(r.text, '"Avanti"'), 'riepilogo minimo con i pulsanti del modulo (pagina non vista)', r.text);
ok(has(r.text, 'obbligatori ancora vuoti') && has(r.text, '!c'), 'segnalati gli obbligatori vuoti (dichiarazioni !c)', r.text);
r = await c.call('browse_task', { params: { 'informativa privacy': true, 'dichiarazione veridicità': true }, submit: 'Avanti' });
ok(has(r.text, '0/2') && (r.text.match(/!c: serve l'ok/g) || []).length === 2 && has(r.text, 'invio non eseguito'), 'consensi !c e invio bloccati senza confirm', r.text);
r = await c.call('browse_task', { params: { 'informativa privacy': true, 'dichiarazione veridicità': true }, submit: 'Avanti', confirm: true, read: 'table' });
ok(has(r.text, '2/2') && has(r.text, 'inviato: "Avanti"') && has(r.text, 'pagina cambiata'), 'con confirm: consensi spuntati e invio', r.text.slice(0, 400));
ok(has(r.text, 'comune\tIschia') && has(r.text, 'data_fine\t15/12/2026') && has(r.text, 'data_inizio\t2026-11-03') && has(r.text, 'ruolo\tlr') && has(r.text, 'fondo\tFondo Nuove Competenze') && has(r.text, 'ateco\t62'), 'riepilogo coerente: autocompletamento, date (formato del campo), radio, menu', r.text);
r = await c.call('browse_task', { submit: ['Invia domanda', 'Conferma invio'], expect: 'Protocollo', extract: { protocollo: 'text' } });
ok(has(r.text, '!c') && has(r.text, 'serve l\'ok'), 'invio irreversibile bloccato senza confirm', r.text);
r = await c.call('browse_task', { submit: ['Invia domanda', 'Conferma invio'], confirm: true, expect: 'Protocollo', extract: { protocollo: 'text' } });
ok(has(r.text, 'atteso "Protocollo": si') && /protocollo = "2026\/004512/.test(r.text), 'invio con modale confermato, verifica attesa e protocollo estratto', r.text);

// ---------- 2. estrazione tipizzata ----------
r = await c.call('browse_task', { url: base + '/dettaglio.html?c=PF-2026-115', extract: { 'importo approvato': 'money', 'ore approvate': 'number', 'scadenza rendicontazione': 'date', referente: 'text', edizioni: 'table' } });
ok(has(r.text, 'importo approvato = "18400.00 EUR"') && has(r.text, 'ore approvate = 120') && has(r.text, 'scadenza rendicontazione = "2026-11-15"') && has(r.text, 'referente = "Mario Rossi"'), 'estrazione tipizzata: denaro, numero, data, testo', r.text);
ok(has(r.text, 'Ed. 6') && has(r.text, 'Edizione\tInizio'), 'estrazione di una tabella', r.text);
r = await c.call('browse_task', { url: base + '/index.html', before: [{ click: 'Elenco progetti' }], extract: { 'progetti trovati': 'number' } });
ok(has(r.text, 'progetti trovati = 25'), 'passi iniziali + numero estratto dal testo', r.text);
r = await c.call('browse_task', { url: base + '/dettaglio.html?c=PF-2026-101', extract: { 'codice CUP': 'text' } });
ok(has(r.text, 'codice CUP: non trovato'), 'estrazione: opzione "non trovato" quando il dato non c\'e\'', r.text);

// ---------- 3. domande, risposte e memoria per sito ----------
r = await c.call('browse_task', { url: base + '/registro.html', params: { luogo: 'Napoli, via Toledo 1', docente: 'Anna Bianchi' } });
const q = r.text.match(/\? "luogo": (?:nessuno \d+% · )?((?:f\d+)?e\d+) "Sede di svolgimento"/) || r.text.match(/\? "luogo":[^\n]*?((?:f\d+)?e\d+) "Sede di svolgimento"/);
ok(has(r.text, '1/2 impostati, 1 da chiarire') && q, 'sinonimo sconosciuto: domanda con candidati e probabilita\' (e il campo giusto tra i candidati)', r.text);
if (q) {
  r = await c.call('browse_task', { params: { luogo: 'Napoli, via Toledo 1' }, answers: { luogo: q[1] } });
  ok(has(r.text, '1/1 impostati'), 'risposta alla domanda: campo compilato', r.text);
  r = await c.call('browse_task', { url: base + '/registro.html', params: { luogo: 'Salerno' } });
  ok(has(r.text, '1/1 impostati') && !has(r.text, '? "'), 'memoria per sito: la seconda volta nessuna domanda', r.text);
}
ok(fs.existsSync(path.join(TMP, 'site-memory.json')), 'memoria salvata su disco accanto al profilo');

// ---------- 4. multilingue ----------
for (const [lang, send, next, cookie] of [['fr', 'Envoyer la demande', 'Suivant', 'Tout refuser'], ['es', 'Enviar solicitud', 'Siguiente', 'Rechazar todo'], ['de', 'Antrag absenden', 'Weiter', 'Alle ablehnen']]) {
  r = await c.call('browse_open', { url: `${base}/form.html?lang=${lang}` });
  ok(has(r.text, `cookie: rifiutati i non necessari (${cookie})`), `[${lang}] cookie rifiutati ("${cookie}")`, r.text.slice(0, 300));
  ok(new RegExp(`btn "${send}" !c`).test(r.text) && new RegExp(`btn "${next}"(?! !c)`).test(r.text), `[${lang}] "${send}" !c, "${next}" navigazione`, r.text);
  ok((r.text.match(/!x/g) || []).length >= 2, `[${lang}] password e numero di carta riservati (!x)`, r.text);
  ok(/chk "[^"]+" \[ \] !c/.test(r.text), `[${lang}] consenso alle condizioni !c`, r.text);
}
r = await c.call('browse_task', { url: `${base}/form.html?lang=de`, params: { 'ragione sociale': 'Alfa GmbH', 'partita iva': 'DE123456789', cap: '10115', comune: 'Berlin', nazione: 'Deutschland', nome: 'Max', cognome: 'Muster', email: 'max@alfa.de', telefono: '+49 30 1234', 'data di nascita': '01/02/1980', 'numero dipendenti': 12, password: 'segreta' } });
ok(has(r.text, '11/12') && has(r.text, 'campo riservato'), '[de] chiavi italiane su modulo tedesco: 11 abbinati, password rifiutata', r.text);
ok(has(r.text, '01.02.1980'), '[de] data nel formato del campo (TT.MM.JJJJ)', r.text);

// ---------- 5. coordinate stile "box", icone, etichette, somiglianza ----------
r = await c.call('browse_open', { url: base + '/canvas.html' });
ok(has(r.text, '"~modifica"') && /"~elimina" !c/.test(r.text) && has(r.text, '"Stampa ricevuta"'), 'pulsanti a icona: nomi dedotti (~) e sensibilita\'', r.text);
r = await c.call('browse_do', { steps: [{ click: { x: (20 + 460) / 1280, y: (120 + 230) / 800 } }] });
ok(has(r.text, 'ok 1/1') && has(r.text, 'clic a (') && has(r.text, 'sede selezionata'), 'clic a coordinate relative su canvas', r.text);
r = await c.call('browse_do', { steps: [{ click: { x: (640 + 80) / 1280, y: (120 + 20) / 800 } }] });
ok(has(r.text, 'BLOCCATO !c') && has(r.text, 'Invia pratica'), 'clic a coordinate su "Invia pratica": bloccato (!c)', r.text);
r = await c.call('browse_screenshot', { labels: true });
ok(!r.isError && r.image, 'screenshot con etichette dei ref', r.text);
r = await c.call('browse_read', { mode: 'find', query: 'e1' });
ok(!/^e\d+$/m.test(r.text), 'etichette rimosse dalla pagina dopo lo screenshot', r.text);
r = await c.call('browse_screenshot', { region: [0, 0, 0.5, 0.5] });
ok(!r.isError && /^(\d+)x(\d+)/.test(r.text) && +r.text.match(/^(\d+)/)[1] <= 640, 'zoom su una regione', r.text);
r = await c.call('browse_view', { filter: 'Invia pratica' });
const inv = (r.text.match(/(e\d+) btn "Invia pratica"/) || [])[1];
r = await c.call('browse_read', { mode: 'describe', ref: inv });
ok(/box \(0-1\): left 0\.5\d* top 0\.15/.test(r.text), 'describe restituisce il riquadro in coordinate 0-1', r.text);
r = await c.call('browse_open', { url: base + '/test.html' });
r = await c.call('browse_do', { steps: [{ click: 'Pulsante custm' }] });
ok(has(r.text, 'ok 1/1') && has(r.text, 'per somiglianza'), 'target con refuso: scelto per somiglianza con percentuale', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Zebra arcobaleno' }] });
ok(has(r.text, 'ok 0/1') && has(r.text, 'nessun elemento'), 'target senza corrispondenza: nessuna azione', r.text);
await c.close();

// ---------- 6. elementi coperti da un overlay ----------
const c2 = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-v2b'), CB_REJECT_COOKIES: 'false' });
r = await c2.call('browse_open', { url: base + '/form.html?lang=en' });
ok(/ cop\b/.test(r.text), 'elementi sotto il banner fisso segnalati come "cop"', r.text);
await c2.close();

srv.close();
console.log(log.join('\n'));
console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
