// Novita' 0.5.5: apertura leggera, schede con ref e righe comuni, nessuna ripetizione dopo una lettura,
// attesa della rete prima di read.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { renderView, readCover } from '../extension/server/lib/render.js';

fs.mkdirSync(TMP, { recursive: true });
const prof = (d) => {
  const p = path.join(TMP, d);
  fs.rmSync(p, { recursive: true, force: true });
  return p;
};
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

// ---- unita' ----
const snap = { meta: { title: 'T' }, alerts: ['Errore'], regions: [], items: [{ id: 'e1', role: 'text', name: 'Da', flags: [] }, { id: 'e2', role: 'btn', name: 'Cerca', flags: [] }, { id: 'e3', role: 'link', name: 'Home', flags: [] }] };
const v = renderView(snap, { url: 'http://x/', rows: false });
ok(has(v, 'http://x/ | T') && has(v, '! Errore') && has(v, '3 elementi (1 campi, 1 pulsanti, 1 link)') && !has(v, 'e1'), 'rows:false: intestazione, avvisi e conteggi, nessuna riga', v);
const cv = readCover('in tutte: Wien Hbf · [ref]=Seleziona\n18:00 | 20:22 | da € 9,90 | [e51]\nCuffie | € 49 →e60');
ok(cv.skip.has('e51') && cv.skip.has('e60') && cv.has('18:00 Wien Hbf 20:22 da € 9,90 Seleziona') && !cv.has('Nessun treno trovato'), 'readCover: ref letti e testo gia\' mostrato', [...cv.skip].join(','));
ok(readCover('') === null, 'readCover senza lettura: null');

// ---- orari (SPA con spinner e rete lenta) ----
const url = base + '/orari.html';
const c = await connect({ CB_PROFILE_DIR: prof('prof-v055'), CB_HUMAN_WAIT: '0' });
const full = await c.call('browse_open', { url });
let r = await c.call('browse_open', { url, rows: false });
ok(!r.isError && has(r.text, 'RailShop') && /\d+ elementi \(/.test(r.text) && !/\be\d+ /.test(r.text), 'browse_open rows:false: solo intestazione e conteggi', r.text);
ok(r.text.length * 4 < full.text.length, `rows:false almeno 4 volte piu' corto (${r.text.length} vs ${full.text.length} caratteri)`);
r = await c.call('browse_open', { url, filter: 'partenza' });
ok(has(r.text, 'Ora di partenza') && !has(r.text, '"Cerca"'), 'browse_open filter: solo le righe che corrispondono', r.text);

r = await c.call('browse_do', {
  steps: [{ type: 'Da', text: 'Wien' }, { pick: 'Wien Hbf' }, { type: 'A', text: 'Salzburg' }, { pick: 'Salzburg Hbf' }, { fill: 'Data di andata', text: '2026-11-12' }, { select: 'Ora di partenza', option: '18:00' }, { click: 'Cerca' }, { read: 'cards' }],
});
const row = (r.text.match(/^21:39 .*$/m) || [''])[0];
const cheap = (row.match(/\[(e\d+)\]/) || [])[1];
ok(!r.isError && has(r.text, 'ok 8/8') && has(row, '9,90') && !!cheap, 'read cards senza wait: attende rete e spinner, la scheda ha il ref del pulsante', r.text);
ok(has(r.text, 'in tutte: Wien Hbf · Salzburg Hbf · [ref]=Seleziona'), 'testi uguali in tutte le schede in una riga "in tutte"', r.text);
ok(!/^\+ e\d+ btn "Seleziona"/m.test(r.text) && !/^» 18:00/m.test(r.text) && has(r.text, "gia' elencati con il ref"), 'diff dopo la lettura: niente pulsanti ne\' testi gia\' nelle schede', r.text);
r = await c.call('browse_do', { steps: [{ click: cheap }], view: 'none' });
const title = (await c.call('browse_view', { filter: 'zzz' })).text;
ok(!r.isError && /scelto 3/.test(title), 'il ref della scheda sceglie il treno giusto (21:39)', r.text + '\n' + title.slice(0, 200));

r = await c.call('browse_task', { url, params: { da: 'Wien Hbf', a: 'Salzburg Hbf', 'data di andata': '12/11/2026', ora: '18:00' }, submit: 'Cerca', read: 'cards' });
ok(!r.isError && /^21:39 .*9,90.*\[e\d+\]/m.test(r.text), 'browse_task read cards: una chiamata, schede con ref', r.text);
ok(!has(r.text, 'pulsanti:') && !/^» 18:00/m.test(r.text), 'browse_task con lettura: niente pulsanti del modulo ne\' testi ripetuti', r.text);
ok(r.text.length < 900, `browse_task compatto (${r.text.length} caratteri)`, r.text);

// ---- schede che sono link interi, spinner decorativo sempre visibile ----
await c.call('browse_open', { url: base + '/cards-link.html', rows: false });
const t0 = Date.now();
r = await c.call('browse_read', { mode: 'cards' });
const ms = Date.now() - t0;
ok(!r.isError && /^Cuffie Beta \| In-ear \| € 29,00 →e\d+$/m.test(r.text) && has(r.text, 'in tutte: Spedizione gratuita'), 'scheda-link intera: ref alla fine (→eN), testo comune raccolto', r.text);
ok(ms < 2000, `spinner decorativo senza rete: la lettura non aspetta (${ms} ms)`);
await c.close();

srv.close();
console.log(log.join('\n'));
console.log(`\nv0.5.5: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
