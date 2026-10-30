// Novita' 0.5.4: upload su input file nascosti dietro aree "trascina qui" e aree cliccabili senza etichetta.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
const prof = (d) => {
  const p = path.join(TMP, d);
  fs.rmSync(p, { recursive: true, force: true });
  return p;
};
const img = path.join(TMP, 'foto.png');
fs.writeFileSync(img, Buffer.from('89504e470d0a1a0a', 'hex'));
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
const ref = (t, re) => (t.match(re) || [])[1];
const out = async (c) => (await c.call('browse_read', { mode: 'find', query: 'a=' })).text;

const c = await connect({ CB_PROFILE_DIR: prof('prof-v054'), CB_HUMAN_WAIT: '0' });
let r = await c.call('browse_open', { url: base + '/upload-zone.html' });
const dz = ref(r.text, /(e\d+) file "Drag & drop your image here"/);
ok(!!dz, 'input file nascosto (display:none) dentro la drop-zone: ha un ref col testo dell\'area', r.text);
ok(!/ area /.test(r.text), 'vista normale: nessuna scansione delle aree (nessun costo in piu\')', r.text);
const plain = r.text.length;

r = await c.call('browse_do', { steps: [{ upload: dz, file: img, confirm: true }], view: 'none' });
ok(!r.isError && has(r.text, 'caricati 1 file') && has(await out(c), 'a=foto.png;'), 'upload sul ref dell\'input nascosto', r.text);

r = await c.call('browse_view', { scope: 'areas' });
const pk = ref(r.text, /(e\d+) area "Click to choose a file"/);
const cube = ref(r.text, /(e\d+) area "~cube\.png 48x48 @[\d.]+,[\d.]+"/);
ok(/aree cliccabili senza nome: \d+/.test(r.text) && pk && cube, 'scope "areas": area con testo e icona senza nome (immagine, misura, centro 0-1)', r.text);
ok(/e\d+ area "~canvas 200x120 @/.test(r.text), 'scope "areas": canvas (visore 3D, mappa) con misura e centro', r.text);
ok(!has(r.text, 'upload-page') && !/area "Image to 3D/.test(r.text), 'scope "areas": il contenitore grande della pagina non e\' un\'area', r.text);
ok(!has(r.text, 'Generate model'), 'scope "areas": i pulsanti che hanno gia\' un ref non sono ripetuti', r.text);

r = await c.call('browse_do', { steps: [{ upload: pk, file: img, confirm: true }], view: 'none' });
ok(!r.isError && has(r.text, 'finestra di scelta file') && has(await out(c), 'b=foto.png;'), 'upload su un\'area che crea l\'input al clic: file chooser', r.text);

r = await c.call('browse_do', { steps: [{ click: cube }], view: 'none' });
ok(!r.isError && has(await out(c), 'c=cliccato'), 'clic sul ref di un\'area senza nome', r.text);

r = await c.call('browse_view', {});
ok(has(r.text, cube + ' area') && r.text.length - plain < 260, 'le aree trovate restano nella vista successiva', r.text);

r = await c.call('browse_open', { url: base + '/upload-zone.html' });
const area = ref((await c.call('browse_view', { scope: 'areas' })).text, /(e\d+) area "Drag & drop your image here"/);
r = await c.call('browse_do', { steps: [{ upload: area, file: img, confirm: true }], view: 'none' });
ok(!r.isError && has(r.text, "input file dell'area") && has(await out(c), 'a=foto.png;'), 'upload sull\'area: usa l\'input file al suo interno senza aprire finestre', r.text);
r = await c.call('browse_do', { steps: [{ upload: area, file: img }], view: 'none' });
ok(has(r.text, '!c caricamento'), 'upload resta !c senza confirm', r.text);
r = await c.call('browse_view', { scope: 'areas' });
const da = ref(r.text, /(e\d+) area "Drop files"/);
ok(!!da, 'scope "areas": zona di trascinamento riconosciuta dalla classe (senza cursore a mano)', r.text);
r = await c.call('browse_do', { steps: [{ upload: da, file: img, confirm: true }], view: 'none' });
ok(!r.isError && has(r.text, 'campo file vicino') && has(await out(c), 'd=foto.png'), 'upload su un\'area che non apre finestre: campo file accanto', r.text);
await c.close();

srv.close();
console.log(log.join('\n'));
console.log(`\nv0.5.4: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
