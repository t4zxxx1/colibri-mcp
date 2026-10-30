// Novita' 0.5.7: read "cards" sceglie le soluzioni vere anche su pagine come Trenitalia
// (componenti display:contents, classi diverse tra varianti, chip con testo per lettori di schermo, pagine enormi,
// orari aria-hidden o solo nel riassunto per i lettori di schermo).
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
const p = path.join(TMP, 'prof-v057');
fs.rmSync(p, { recursive: true, force: true });
const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port + '/soluzioni.html';
let pass = 0;
let fail = 0;
const log = [];
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 1600) : ''}`);
};

const c = await connect({ CB_PROFILE_DIR: p, CB_HUMAN_WAIT: '0' });
const cards = async (q, extra = {}) => {
  await c.call('browse_open', { url: base + q, rows: false });
  return (await c.call('browse_read', { mode: 'cards', ...extra })).text;
};

let r = await cards('?nomega');
ok(/^schede 1-10 di 10 \(app-solution\)/m.test(r), 'sceglie le 10 soluzioni, non le 20 chip (display:contents, classi diverse)', r);
ok(!/chip|Mostra informazioni/.test(r), 'nessuna chip dei filtri nelle schede', r);
ok(/^18:28 \| 19:16 \| Frecciarossa \| 19,90 € \| \[e\d+\]$/m.test(r), 'orari aria-hidden ma visibili, prezzo e ref nella riga', r);
ok(/^18:31 \| 19:19 \| \[e\d+ 1 cambio\] \| 20,90 € \| \[e\d+\]$/m.test(r), 'soluzione con cambio nello stesso gruppo', r);
ok(!/Soluzione n\./.test(r), 'riassunto nascosto omesso quando gli orari si vedono gia\'', r);
ok(/^in tutte: 0h 48min · \[ref\]=Seleziona$/m.test(r), 'testi comuni in una riga', r);

r = await cards('');
ok(/^schede 1-10 di 10 /m.test(r) && /^18:55 \| 19:43 /m.test(r), 'pagina con oltre 9000 nodi nascosti prima dei risultati', r.slice(0, 400));
const pick = (r.match(/^18:31 .*\[(e\d+)\]$/m) || [])[1];
await c.call('browse_do', { steps: [{ click: pick }], view: 'none' });
const title = (await c.call('browse_view', { filter: 'zzz' })).text;
ok(!!pick && /scelta 2/.test(title), 'il ref della riga sceglie la soluzione giusta', title.slice(0, 200));

r = await cards('?sronly');
ok(/^Soluzione n\. 1 ; partenza ore 18:28 arrivo ore 19:16 \| Frecciarossa \| 19,90 €/m.test(r), 'orari solo per i lettori di schermo: il riassunto entra nella riga', r);
ok(/^schede 1-10 di 10 /m.test(r), 'senza orari visibili vince comunque il gruppo giusto', r.slice(0, 300));

r = await cards('?nomega', { selector: 'app-solution' });
ok(/^schede 1-10 di 10 \(app-solution\)/m.test(r) && /^18:28 /m.test(r), 'selector su componenti display:contents', r.slice(0, 300));

await c.close();
srv.close();
console.log(log.join('\n'));
console.log(`\nv0.5.7: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
