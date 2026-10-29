// Novita' 0.5.3: browse_search (risultati compatti, niente annunci, link reali) e date in piu' campi in browse_task.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { fieldsFrom, monthOf, parseDateTime } from '../extension/server/lib/engine.js';

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

// ---------- unita': mesi, date con ora, gruppi ----------
ok(monthOf('giugno') === 6 && monthOf('Jun') === 6 && monthOf('juin') === 6 && monthOf('06') === 6 && monthOf('Mar') === 3 && monthOf('Mese') === null, 'mesi: nomi it/en/fr, abbreviazioni e numeri');
ok(JSON.stringify(parseDateTime('12/06/2025 10:30')) === '{"d":12,"mo":6,"y":2025,"h":10,"mi":30}' && parseDateTime('2025-06-12T08:05').h === 8 && parseDateTime('ciao') === null, 'data con ora: "12/06/2025 10:30" e ISO');
const it = (id, role, name, gx = {}) => ({ id, role, name, flags: [], reg: 0, gx });
const f1 = fieldsFrom([it('e1', 'sel', 'Giorno', { nm: 'dd' }), it('e2', 'sel', 'Mese', { nm: 'mm' }), it('e3', 'sel', 'Anno', { nm: 'yyyy', grp: 'Data di arrivo' })], [{}]);
ok(f1.some((f) => f.kind === 'dateparts' && f.name === 'Data di arrivo' && f.parts.length === 3), 'tre menu giorno/mese/anno = un campo data', JSON.stringify(f1.map((f) => [f.kind, f.name])));
const f2 = fieldsFrom([it('e1', 'text', 'Dal', { ph: 'gg/mm/aaaa' }), it('e2', 'text', 'Al', { ph: 'gg/mm/aaaa' })], [{}]);
ok(!f2.some((f) => f.kind === 'dateparts'), 'due campi data interi (gg/mm/aaaa) non diventano un gruppo');
const f3 = fieldsFrom([it('e1', 'text', 'GG', { nm: 'dob_day' }), it('e2', 'text', 'MM', { nm: 'dob_month' }), it('e3', 'text', 'AAAA', { nm: 'dob_year' }), it('e4', 'text', 'Ore di formazione', { nm: 'ore' })], [{}]);
const g3 = f3.find((f) => f.kind === 'dateparts');
ok(g3 && g3.parts.length === 3 && g3.name === 'dob', 'campo "Ore di formazione" dopo la data non diventa l\'ora della data', JSON.stringify(g3 && g3.parts.map((p) => p.part)));

const c = await connect({ CB_PROFILE_DIR: prof('prof-v053'), CB_HUMAN_WAIT: '0', CB_SEARCH_URL: base + '/search-ddg.html?q={q}' });

// ---------- browse_search ----------
let r = await c.call('browse_search', { query: 'treni vienna salisburgo' });
const lines = r.text.split('\n');
ok(!r.isError && /ricerca "treni vienna salisburgo": 3 risultati/.test(lines[0]), 'search: intestazione con numero di risultati', r.text);
ok(has(r.text, '1. ÖBB Tickets - Vienna Salisburgo | shop.oebbtickets.at/it/biglietti | Prenota i biglietti'), 'search: titolo | URL reale (redirect DDG sciolto) | estratto', r.text);
ok(!has(r.text, 'sponsorizzata') && !has(r.text, 'ads.example'), 'search: annunci esclusi', r.text);
ok(!has(r.text, 'duplicato'), 'search: risultati duplicati (stesso URL) esclusi', r.text);
ok(has(r.text, '3. Train travel in Austria | Seat61 | www.seat61.com/Austria.htm'), 'search: www mantenuto, https omesso', r.text);
ok(r.text.length < 520, `search: risposta compatta (${r.text.length} caratteri per 3 risultati)`, r.text);
r = await c.call('browse_search', { query: 'treni', max: 1 });
ok(r.text.split('\n').length === 2, 'search: max limita i risultati', r.text);
r = await c.call('browse_view', {});
ok(has(r.text, 'Search'), 'search: la pagina dei risultati resta aperta per browse_do / browse_view', r.text.slice(0, 300));
await c.close();

const cb = await connect({ CB_PROFILE_DIR: prof('prof-v053b'), CB_HUMAN_WAIT: '0', CB_SEARCH_URL: base + '/search-bing.html?q=' });
r = await cb.call('browse_search', { query: 'colibri mcp' });
ok(has(r.text, 'GitHub - t4zxxx1/colibri-mcp | github.com/t4zxxx1/colibri-mcp | The hummingbird') && !has(r.text, 'Ad result'), 'search (Bing): link /ck/a decodificato, annuncio escluso', r.text);
await cb.close();

const cf = await connect({ CB_PROFILE_DIR: prof('prof-v053f'), CB_HUMAN_WAIT: '0', CB_SEARCH_URL: `${base}/search-challenge.html?q={q} ${base}/search-bing.html?q={q}` });
r = await cf.call('browse_search', { query: 'colibri mcp' });
ok(has(r.text, 'chiede una verifica DuckDuckGo: uso il motore successivo') && has(r.text, 'GitHub - t4zxxx1/colibri-mcp'), 'search: verifica sul primo motore → risultati dal motore di riserva, senza fermarsi', r.text);
await cf.close();
const ce = await connect({ CB_PROFILE_DIR: prof('prof-v053g'), CB_HUMAN_WAIT: '0', CB_SEARCH_URL: `${base}/index.html?q={q} ${base}/search-ddg.html?q={q}` });
r = await ce.call('browse_search', { query: 'treni' });
ok(has(r.text, 'nessun risultato leggibile') && has(r.text, '1. ÖBB Tickets'), 'search: pagina senza risultati → motore successivo', r.text);
await ce.close();
const cg = await connect({ CB_PROFILE_DIR: prof('prof-v053h'), CB_HUMAN_WAIT: '0', CB_SEARCH_URL: `${base}/search-challenge.html?q={q}` });
r = await cg.call('browse_search', { query: 'x' });
ok(has(r.text, 'verifica DuckDuckGo') && has(r.text, "chiedi all'utente"), 'search: verifica sull\'ultimo motore → pausa per l\'utente (nessun aggiramento)', r.text);
await cg.close();

const cd = await connect({ CB_PROFILE_DIR: prof('prof-v053c'), CB_HUMAN_WAIT: '0', CB_ALLOWED_DOMAINS: 'example.com' });
r = await cd.call('browse_search', { query: 'x' });
ok(r.isError && has(r.text, 'duckduckgo.com') && has(r.text, 'consentiti'), 'search: rispetta CB_ALLOWED_DOMAINS', r.text);
await cd.close();

// ---------- date in piu' campi ----------
const ct = await connect({ CB_PROFILE_DIR: prof('prof-v053d'), CB_HUMAN_WAIT: '0' });
r = await ct.call('browse_task', { url: base + '/date-parts.html', params: { nome: 'Mario', 'data di partenza': '2026-06-12 10:30', 'data di nascita': '05/03/1990' }, view: 'none' });
ok(!r.isError && /parametri: 3\/3 impostati/.test(r.text), 'task: 3/3 parametri con due date divise', r.text);
ok(has(r.text, 'Data di partenza: 12 | giugno | 2026 | 10 | 30') && has(r.text, 'Data di nascita: 05 | 03 | 1990'), 'task: nota con le parti scritte', r.text);
let out = await ct.call('browse_read', { mode: 'find', query: 'partenza=' });
ok(has(out.text, 'partenza=12/giugno/2026 10:30; nascita=05-03-1990; nome=Mario; ore='), 'pagina: menu giorno/mese (nome)/anno/ora/minuti e campi GG/MM/AAAA compilati, "Ore di formazione" intatto', out.text);
r = await ct.call('browse_task', { params: { 'data di partenza': '01/01/2027 08:20' }, view: 'none' });
out = await ct.call('browse_read', { mode: 'find', query: 'partenza=' });
ok(has(out.text, 'partenza=01/gennaio/2027 08:15') && has(r.text, 'minuti 15 invece di 20'), 'task: minuti a passi di 15 → il piu\' vicino, segnalato', r.text + '\n' + out.text);
r = await ct.call('browse_task', { params: { 'data di partenza': '12/06/2031' }, view: 'none' });
ok(has(r.text, 'nessuna opzione per 2031'), 'task: anno assente dal menu → errore chiaro, nessuna scelta a caso', r.text);
await ct.close();

// ---------- nessuna regressione: data in un solo campo ----------
const cr = await connect({ CB_PROFILE_DIR: prof('prof-v053e'), CB_HUMAN_WAIT: '0' });
r = await cr.call('browse_task', { url: base + '/registro.html', params: { 'data della lezione': '12/06/2026' }, view: 'none' });
ok(/parametri: 1\/1/.test(r.text) && !has(r.text, ' | '), 'data in un solo campo nativo: invariata', r.text);
await cr.close();

srv.close();
console.log(log.join('\n'));
console.log(`\nv0.5.3: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
