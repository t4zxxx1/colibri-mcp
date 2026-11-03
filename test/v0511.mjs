// Novita' 0.5.11 (dall'analisi di 221 chiamate reali): filtri con "a|b", avvisi Struts e niente falsi avvisi
// dei negozi, fill non accettato dal sito, clic lenti o coperti, schede pubblicitarie non attive, popup
// promozionali chiusi, alias dei passi (read:find/describe, scroll numerico), tabelle Angular Material.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { filterAlts, matchesFilter } from '../extension/server/lib/render.js';
import { cardsOut } from '../extension/server/lib/session.js';

fs.mkdirSync(TMP, { recursive: true });
const root = path.join(TMP, 'v0511');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
let pass = 0;
let fail = 0;
const log = [];
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 1800) : ''}`);
};

// ---------- unita' ----------
ok(JSON.stringify(filterAlts('Percors|Piano| ID ')) === '["percors","piano","id"]', 'filtro: "|" divide le alternative', JSON.stringify(filterAlts('Percors|Piano| ID ')));
ok(matchesFilter('Guida alla rendicontazione', filterAlts('guida|pdf')) && !matchesFilter('Home', filterAlts('guida|pdf')), 'filtro: basta una alternativa');
const R = { total: 3, sel: 'div.x', items: [{ row: 'Giacca nera M', p: 10, t: 10 }, { row: 'Giacca blu L', p: 8, t: 8 }, { row: 'Maglia nera M', p: 5, t: 5 }] };
let u = cardsOut(R, { filter: 'giacca nera|blu' });
ok(u.includes('Giacca nera') && u.includes('Giacca blu') && !u.includes('Maglia'), 'cards: filtro con alternative per parola', u);

const c = await connect({ CB_PROFILE_DIR: path.join(root, 'prof'), CB_HUMAN_WAIT: '0' });

// 1. filtro con | (vista e apertura) + ripiego sul testo della pagina
let r = (await c.call('browse_open', { url: base + '/portale511.html', filter: 'piano|carica' })).text;
ok(/Id Piano/i.test(r) && /Carica dati/.test(r), 'browse_open filter "piano|carica": elementi di entrambe le alternative', r);
r = (await c.call('browse_view', { filter: 'percors|rendicont' })).text;
ok(/Percorso sicurezza cantieri/.test(r) && /Guida rendicontazione/.test(r), 'browse_view filter "percors|rendicont": righe trovate', r);
r = (await c.call('browse_view', { filter: 'aggiornamento ieri|zzz' })).text;
ok(/testo della pagina con .*non interattivo/.test(r) && /ultimo aggiornamento ieri/.test(r), 'nessun elemento interattivo: ripiego sul testo della pagina', r);

// 2. avvisi: Struts e "Attenzione!" si', prezzi / stati dei negozi no
r = (await c.call('browse_view', {})).text;
ok(/Attenzione! La data di pagamento/.test(r), 'avviso "Attenzione!" senza classi riconosciuto', r);
ok(/Il piano 4410 non e' in stato modificabile/.test(r), 'avviso Struts (actionErrors) riconosciuto', r);
ok(!/From €34|Prezzo Di Vendita|Confronta 2 prodotti|! \*$/m.test(r), 'niente falsi avvisi da prezzi, contatori e asterischi', r);

// 8. Angular Material: righe cliccabili, pulsanti con sola icona, campi in tabella
ok(/"Id Piano"/.test(r) && !/ricercaAttivitaViewComponent/.test(r), 'campo con binding come nome: etichetta della cella vicina', r);
ok(/"Codice cup"/i.test(r), 'campo senza etichetta: binding reso leggibile', r);
ok(/~elimina/.test(r) && /Scarica PDF del piano/.test(r) && !/expand_more|file_download/.test(r.replace(/~[^"]*/g, '')), 'pulsanti mat-icon: nome dalla legatura o dal tooltip', r);
const rowRef = (r.match(/(e\d+) clk "123 · Percorso sicurezza cantieri[^"]*"/) || [])[1];
ok(!!rowRef, 'riga con cursor:pointer cliccabile, nominata dalle celle', r);
if (rowRef) {
  r = (await c.call('browse_do', { steps: [{ click: rowRef }, { find: 'Dettaglio piano 123' }] })).text;
  ok(/4 attivita' rendicontate/.test(r), 'clic sulla riga: si espande il dettaglio', r);
}

// 3. fill non accettato (il sito svuota il campo con un alert)
r = (await c.call('browse_do', { steps: [{ fill: 'Spesa Totale', text: '3777,07' }], view: 'none' })).text;
ok(/⚠/.test(r) && /non l'ha accettato|non accettat/.test(r) && /usa il PUNTO/.test(r) && !/^ok 1\/1\s*$/m.test(r.split('\n')[0]), 'fill svuotato dal sito: avviso con il testo dell\'alert', r);
r = (await c.call('browse_do', { steps: [{ fill: 'Spesa Totale', text: '3777.07' }], view: 'none' })).text;
ok(/^ok 1\/1/.test(r) && !/⚠/.test(r), 'fill accettato: nessun avviso', r);

// 7. alias: read:"find", read:"describe", scroll numerico e {x,y}
r = (await c.call('browse_do', { steps: [{ read: 'find', query: 'Percorsi formativi' }], view: 'none' })).text;
ok(/^ok 1\/1/.test(r) && /Percorsi formativi disponibili/.test(r), 'read:"find" accettato come passo find', r);
const delRef = ((await c.call('browse_view', { filter: 'elimina' })).text.match(/(e\d+) btn "~elimina"/) || [])[1];
r = (await c.call('browse_do', { steps: [{ read: 'describe', target: delRef }], view: 'none' })).text;
ok(/^ok 1\/1/.test(r) && new RegExp(delRef).test(r), 'read:"describe" accettato nei passi', r);
r = (await c.call('browse_do', { steps: [{ scroll: 300 }, { scroll: { x: 0, y: -100 } }, { scroll: '200' }], view: 'none' })).text;
ok(/^ok 3\/3/.test(r), 'scroll numerico, {x,y} e "200" accettati', r);

// 4. clic coperto da un velo / clic lento ma riuscito
const caricaRef = ((await c.call('browse_view', { filter: 'carica dati|stato' })).text.match(/(e\d+) btn "Carica dati"/) || [])[1];
const statoRef = ((await c.call('browse_view', { filter: 'stato' })).text.match(/(e\d+) btn "Stato"/) || [])[1];
r = (await c.call('browse_do', { steps: [{ click: statoRef }], view: 'none' })).text;
ok(/^ok 1\/1/.test(r) && /Stato aggiornato|lento ma riuscito/.test(r), 'clic lento (pagina occupata oltre 5 s) ma riuscito: non e\' un errore', r);
r = (await c.call('browse_do', { steps: [{ click: caricaRef }, { click: caricaRef }], view: 'none' })).text;
ok(/coperto da modale "Elaborazione in corso"/.test(r) && /force/.test(r), 'clic coperto: errore che nomina il modale', r);

// 6. popup newsletter chiuso da solo; finestra "Filtri" lasciata aperta
r = (await c.call('browse_open', { url: base + '/negozio511.html' })).text;
ok(/chiuso popup "Iscriviti alla newsletter/.test(r) && !/MODALE/.test(r) && /Guida taglie/.test(r), 'popup newsletter chiuso automaticamente', r);
r = (await c.call('browse_do', { steps: [{ click: 'Filtri' }], view: 'full' })).text;
ok(/MODALE "Filtri"/.test(r) && /Taglia M/.test(r) && !/chiuso popup/.test(r), 'finestra "Filtri" con piu\' campi non chiusa', r);
await c.call('browse_do', { steps: [{ click: 'Chiudi' }], view: 'none' });

// 5. scheda pubblicitaria aperta durante il caricamento: non diventa attiva
r = (await c.call('browse_do', { steps: [{ goto: base + '/negozio511.html?ad=1' }, { wait: 1500 }, { tab: 'list' }], view: 'none' })).text;
ok(!/ora attiva/.test(r) && /schede: .*\* [^\n]*negozio511\.html\?ad=1/.test(r.replace(/\n/g, ' ')), 'scheda aperta da sola durante goto: non attiva', r);
// un link target=_blank cliccato nel passo diventa invece attivo
r = (await c.call('browse_do', { steps: [{ click: 'Guida taglie' }], view: 'none' })).text;
ok(/ora attiva|Offerta speciale|promo511/.test(r), 'link cliccato che apre una scheda: diventa attiva', r);

await c.close();
srv.close();
console.log(log.join('\n'));
console.log(`\nv0511: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
