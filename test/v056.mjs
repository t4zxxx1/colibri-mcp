// Novita' 0.5.6: id/name/title "oscurati" da campi omonimi, lettura dopo un invio con risultati lenti, tendina al posto del campo.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
const p = path.join(TMP, 'prof-v056');
fs.rmSync(p, { recursive: true, force: true });
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
const c = await connect({ CB_PROFILE_DIR: p, CB_HUMAN_WAIT: '0' });

// 1) form con campi chiamati id/name/title/action: form.id e' un elemento, non una stringa
let r = await c.call('browse_open', { url: base + '/clobber.html' });
ok(!r.isError && !/replace is not a function/.test(r.text) && has(r.text, 'Vai'), 'open: form con campo "id"/"name"/"title" non rompe la pagina', r.text);

// 2) invio che porta a una pagina con schede lente
r = await c.call('browse_task', { url: base + '/ricerca-lenta.html', params: { da: 'Napoli Afragola', a: 'Napoli Leopardi' }, submit: 'Cerca', read: 'cards' });
ok(!r.isError && /18:28/.test(r.text) && /18:58/.test(r.text) && !has(r.text, 'nessun gruppo'), 'task: dopo l\'invio aspetta le schede lente e le legge', r.text);

// 3) tendina al posto del campo: la domanda spiega come usarla
r = await c.call('browse_task', { url: base + '/tendina.html', params: { partenza: 'Roma', orario: '18:00' }, submit: 'Cerca' });
ok(has(r.text, 'tendina') && /before/.test(r.text) && has(r.text, 'Orario'), 'task: parametro che corrisponde a una tendina -> suggerisce before con il clic', r.text);
await c.close();
srv.close();
console.log(log.join('\n') + `\n\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
