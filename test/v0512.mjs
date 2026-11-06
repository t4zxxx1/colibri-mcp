// Novita' 0.5.12: editor di codice coperto (CodeMirror), fill/type senza falsi positivi per somiglianza,
// type nell'elemento gia' focalizzato o dopo clic a coordinate.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
const root = path.join(TMP, 'v0512');
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

const c = await connect({ CB_PROFILE_DIR: path.join(root, 'prof'), CB_HUMAN_WAIT: '0' });
await c.call('browse_open', { url: base + '/editor512.html' });
const out = async () => (await c.call('browse_do', { steps: [{ click: 'Esegui' }, { find: 'eseguita' }], view: 'none' })).text;

// 1. fill per nome inventato: NON deve finire in un campo "simile" (prima: etichetta dei preferiti, 71%)
let r = (await c.call('browse_do', { steps: [{ fill: 'sql_query', text: 'SELECT 1' }], view: 'none' })).text;
ok(/nessun elemento|piu' simili|ambiguo/i.test(r) && !/^ok 1\/1/.test(r), 'fill con nome inesistente: errore, non un campo scelto per somiglianza', r);
r = (await c.call('browse_view', { filter: 'preferiti' })).text;
ok(!/SELECT 1/.test(r), 'il campo dei preferiti resta vuoto', r);

// 2. fill sulla textarea coperta (ref esplicito): prima falliva per timeout, ora inserisce da tastiera
const ref = ((await c.call('browse_view', { scope: 'areas' })).text.match(/(e\d+) area/) || (await c.call('browse_view', {})).text.match(/(e\d+) area "cm-input"/) || [])[1];
ok(!!ref, 'la textarea dell\'editor e\' elencata', '');
if (ref) {
  r = (await c.call('browse_do', { steps: [{ fill: ref, text: 'SELECT 42' }], view: 'none' })).text;
  ok(/^ok 1\/1/.test(r) && /editor coperto/.test(r), 'fill su editor coperto: inserito da tastiera con avviso', r);
  r = await out();
  ok(/eseguita: SELECT 42/.test(r), 'il modello dell\'editor contiene il testo', r);

  // 3. type su editor coperto: il clic fallisce, si ripiega sul focus
  r = (await c.call('browse_do', { steps: [{ type: ref, text: ' -- fine' }], view: 'none' })).text;
  ok(/^ok 1\/1/.test(r), 'type su editor coperto: nessun timeout', r);
  r = await out();
  ok(/SELECT 42 -- fine/.test(r), 'type ha scritto nell\'editor', r);
}

// 4. type senza ref: dopo un clic a coordinate (punto dentro l'editor)
r = (await c.call('browse_do', { steps: [{ click: { x: 0.2, y: 0.1 } }, { type: 'focus', text: ' /*coordinate*/' }], view: 'none' })).text;
ok(/^ok 2\/2/.test(r) || /digitato/.test(r), 'type:"focus" scrive nell\'elemento attivo', r);

// 5. read:"table" senza target: la tabella visibile piu' grande, non la prima (nascosta) del DOM
await c.call('browse_open', { url: base + '/tables512.html' });
r = (await c.call('browse_do', { steps: [{ read: 'table' }], view: 'none' })).text;
ok(/user_loggedin/.test(r) && /course_viewed/.test(r) && !/Mostra logo/.test(r), 'read:table sceglie la tabella visibile con piu\' righe', r);

// 6. script: colibri.text() e colibri.tables() esistono (i nomi nudi text()/tables() no)
r = (await c.call('browse_do', { steps: [], view: 'none', script: 'const t = await colibri.tables({}); return JSON.stringify({ n: t.length, first: t[1] });' })).text;
ok(/"n":5/.test(r.replace(/\s/g, '')) || /user_loggedin/.test(r), 'colibri.tables() restituisce le righe della tabella', r);

await c.close();
srv.close();
console.log(log.join('\n'));
console.log(`\nv0512: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
