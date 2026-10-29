// Difetti emersi usando il browser compatto su siti reali (motore voli, portali): attesa di un testo che compare
// prima in un elemento nascosto, campi che aprono una finestra e spostano il focus, pagine ricostruite dopo la scelta
// di un suggerimento, suggerimenti equivalenti (citta' / aeroporto / stazione).
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
fs.rmSync(path.join(TMP, 'prof-real'), { recursive: true, force: true });
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
const c = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-real') });

// ---------- 1. waitFor: il testo compare prima in elementi nascosti ----------
await c.call('browse_open', { url: base + '/attesa.html' });
let r = await c.call('browse_do', { steps: [{ waitFor: 'Risultati pronti' }, { find: 'Trovati' }], view: 'none' });
ok(has(r.text, 'ok 2/2') && has(r.text, 'Trovati 3 risultati') && r.ms < 6000, 'waitFor: attende la copia visibile e non si ferma su quella nascosta', `${r.ms | 0} ms\n${r.text}`);

await c.call('browse_open', { url: base + '/attesa.html?nascosto' });
r = await c.call('browse_do', { steps: [{ waitFor: 'Risultati pronti', timeout: 1200 }], view: 'none' });
ok(/presente \(\d+\) ma non visibile/.test(r.text) && r.ms < 4000, 'waitFor: timeout configurabile e messaggio che distingue "nascosto" da "assente"', `${r.ms | 0} ms\n${r.text}`);

await c.call('browse_open', { url: base + '/attesa.html?nascosto' });
r = await c.call('browse_do', { steps: [{ waitFor: 'Questa frase non esiste', timeout: 1000 }], view: 'none' });
ok(has(r.text, 'non apparso') && r.ms < 4000, 'waitFor: testo assente, errore rapido con timeout breve', `${r.ms | 0} ms\n${r.text}`);

// ---------- 2. digitazione in un campo che apre una finestra ----------
await c.call('browse_open', { url: base + '/combo-modale.html' });
r = await c.call('browse_do', { steps: [{ type: 'Da dove?', text: 'Zurich' }, { find: 'eco:' }], view: 'none' });
ok(has(r.text, 'eco: Zurich'), 'type: nessun carattere perso quando il clic apre una finestra e sposta il focus', r.text);

// ---------- 3. browse_task su campi con finestra, nodi ricostruiti, suggerimenti equivalenti ----------
await c.call('browse_open', { url: base + '/combo-modale.html' });
r = await c.call('browse_task', { params: { 'Da dove?': 'Zurich', 'Verso dove?': 'Londra' }, confidence: 'autonomous', view: 'none' });
ok(has(r.text, '2/2 impostati') && !has(r.text, '✗'), 'browse_task: due campi con finestra, nessun riferimento scaduto (il secondo si ritrova per nome)', r.text);
ok(has(r.text, 'equivalenti') , 'browse_task autonomous: suggerimenti equivalenti, scelto il primo e dichiarato', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Cerca' }, { find: 'Ricerca:' }], view: 'none' });
ok(has(r.text, 'Ricerca: Zurich Airport (ZRH) -> Londra, Regno Unito'), 'valori finali nella pagina', r.text);

await c.call('browse_open', { url: base + '/combo-modale.html' });
r = await c.call('browse_task', { params: { 'Da dove?': 'Zurich', 'Verso dove?': 'Londra' }, view: 'none' });
ok(has(r.text, '? "Da dove?"') && has(r.text, 'testo del suggerimento'), 'browse_task balanced: suggerimenti equivalenti, domanda con istruzioni per rispondere', r.text);
ok(!has(r.text, 'non trovato') && !has(r.text, 'scaduto'), 'dopo una domanda la finestra viene chiusa e gli altri campi restano utilizzabili', r.text);
r = await c.call('browse_task', { params: { 'Da dove?': 'Zurich', 'Verso dove?': 'Londra' }, answers: { 'Da dove?': 'Zurich Airport', 'Verso dove?': 'Heathrow' }, view: 'none' });
ok(has(r.text, '2/2 impostati') && !has(r.text, '? "'), 'browse_task: risposta alla domanda con il testo del suggerimento', r.text);
r = await c.call('browse_do', { steps: [{ click: 'Cerca' }, { find: 'Ricerca:' }], view: 'none' });
ok(has(r.text, 'Ricerca: Zurich Airport (ZRH) -> Londra Heathrow (LHR)'), 'valori finali scelti dall\'utente', r.text);

await c.close();
srv.close();
console.log(log.join('\n'));
console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
