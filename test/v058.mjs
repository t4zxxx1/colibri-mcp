// Novita' 0.5.8: meno token sulle pagine reali (Vinted, Amazon, calendari):
// schede con link, testo solo del contenuto principale, calendari compatti, modelli URL dei filtri,
// schede inutili chiuse da sole, profili di tool.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
const root = path.join(TMP, 'v058');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const p = path.join(root, 'prof');
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

const c = await connect({ CB_PROFILE_DIR: p, CB_HUMAN_WAIT: '0' });

// 1. schede con link
await c.call('browse_open', { url: base + '/annunci.html', rows: false });
let r = (await c.call('browse_read', { mode: 'cards', links: true })).text;
ok(/^schede 1-8 di 8 /m.test(r), '8 annunci come schede', r);
ok(/url:\/annunci\.html\?item=3(\s|$)/m.test(r), 'link per scheda senza parametri di tracciamento', r);
ok(!/utm_|ref=home|#top/.test(r), 'utm, ref e hash tolti', r);
ok(r.includes('url:' + base + '+percorso'), 'origine comune detta una volta', r);
const plain = (await c.call('browse_read', { mode: 'cards' })).text;
ok(!/url:/.test(plain), 'senza links:true nessun url', plain);

// 2. testo principale
await c.call('browse_open', { url: base + '/articolo.html', rows: false });
r = (await c.call('browse_read', { mode: 'text' })).text;
ok(/Paragrafo 6 della recensione/.test(r) && /299,00/.test(r), 'testo dell\'articolo presente', r);
ok(!/Reparto numero|Scorciatoia|cookie|Contatti, privacy/.test(r), 'menu, scorciatoie, cookie e footer esclusi', r);
ok(/solo contenuto principale/.test(r), 'nota sul taglio', r.slice(0, 300));
const all = (await c.call('browse_read', { mode: 'text', selector: 'body' })).text;
ok(/Reparto numero 60/.test(all), 'selector:"body" restituisce tutto', all.slice(0, 200));
ok(r.length * 2 < all.length, `testo principale piu' corto (${r.length} vs ${all.length} caratteri)`);

// 3. calendario nella finestra: righe consecutive raggruppate
await c.call('browse_open', { url: base + '/calendario.html', rows: false });
r = (await c.call('browse_do', { steps: [{ click: { name: 'Date' } }] })).text;
ok(/e\d+\.\.e\d+ btn "1"\.\."31" \(31/.test(r), 'luglio in una riga', r);
ok(/e\d+\.\.e\d+ btn "1"\.\."30" \(30/.test(r), 'agosto in una riga', r);
ok(r.split('\n').length < 20, `diff corto (${r.split('\n').length} righe)`, r);
const v = (await c.call('browse_view', {})).text;
ok(/btn "1"\.\."31"/.test(v) && v.split('\n').length < 20, 'anche la vista completa raggruppa', v);
const day = (await c.call('browse_view', { filter: '15' })).text;
ok(/btn "15"/.test(day), 'con filter i giorni restano singoli', day);

// 4. memoria dei filtri
await c.call('browse_open', { url: base + '/annunci.html', rows: false });
r = (await c.call('browse_do', { steps: [{ click: { name: 'Uomo taglia M' } }], view: 'none' })).text;
ok(/URL salvato come modello/.test(r), 'URL dei filtri salvato', r);
const saved = JSON.parse(fs.readFileSync(path.join(root, 'site-filters.json'), 'utf8'));
ok(JSON.stringify(saved).includes('cat=uomo&taglia=M'), 'file site-filters.json', JSON.stringify(saved));
r = (await c.call('browse_open', { url: base + '/annunci.html', rows: false })).text;
ok(/modelli URL gia' usati qui/.test(r) && /cat=uomo&taglia=M&order=price/.test(r) && /Uomo taglia M/.test(r), 'modello mostrato all\'apertura con il percorso', r);
r = (await c.call('browse_open', { url: base + '/annunci.html?cat=donna', rows: false })).text;
ok(!/modelli URL/.test(r), 'niente modelli se l\'URL ha gia\' parametri', r);

// 5. scheda inutile aperta da un clic
await c.call('browse_open', { url: base + '/annunci.html', rows: false });
r = (await c.call('browse_do', { steps: [{ click: { name: 'Offerta partner' } }], view: 'none' })).text;
ok(/chiusa scheda inutile/.test(r), 'popup about:blank chiuso', r);
r = (await c.call('browse_do', { steps: [{ tab: 'list' }], view: 'none' })).text;
ok(!/about:blank/.test(r) && /annunci\.html/.test(r), 'resta solo la scheda utile', r);

// 6. stato visibile senza screenshot: campo verde/rosso, avanzamento, banner cookie, niente codice nel testo
await c.call('browse_open', { url: base + '/stato.html', rows: false });
r = (await c.call('browse_view', {})).text;
ok(/^! avanzamento Coda di elaborazione: 40%$/m.test(r), 'avanzamento in percentuale', r);
ok(/^! banner cookie aperto: e\d+ "Accetta" · e\d+ "Personalizza"$/m.test(r), 'banner cookie con i suoi pulsanti', r);
r = (await c.call('browse_do', { steps: [{ fill: { name: 'Codice sconto' }, text: 'XYZ' }, { click: { name: 'Usa codice' }, confirm: true }] })).text;
ok(/"Codice sconto" =?"?XYZ"? .*inv »"Codice non valido o scaduto"|inv »"Codice non valido o scaduto"/.test(r), 'codice rifiutato: inv e messaggio sul campo', r);
r = (await c.call('browse_do', { steps: [{ fill: { name: 'Codice sconto' }, text: 'SCONTO10' }, { click: { name: 'Usa codice' }, confirm: true }] })).text;
ok(/ ok »"Codice applicato: -10%"/.test(r), 'codice accettato: ok e messaggio sul campo', r);
ok(!/! Codice applicato/.test(r), 'messaggio non ripetuto tra gli avvisi', r);
r = (await c.call('browse_do', { steps: [{ click: { name: 'Aggiorna riepilogo' } }] })).text;
ok(/totale 269,10/.test(r) && !/dataLayer|gtag/.test(r), 'testo nuovo senza JavaScript', r);
r = (await c.call('browse_read', { mode: 'text' })).text;
ok(/portineria/.test(r) && /269,10/.test(r) && !/dataLayer|var config|"currency"/.test(r), 'read text senza righe di codice', r);

await c.close();

// 7. profili di tool
const sizes = {};
for (const prof of ['all', 'lite', 'read', 'search,open']) {
  const k = await connect({ CB_PROFILE_DIR: p + '-' + prof.replace(/\W/g, ''), CB_TOOLS: prof });
  const t = (await k.client.listTools()).tools;
  sizes[prof] = { n: t.length, chars: JSON.stringify(t).length + (k.client.getInstructions() || '').length };
  if (prof === 'read') ok(!/browse_do|browse_task|confirm/.test(k.client.getInstructions()), 'istruzioni senza tool assenti', k.client.getInstructions());
  await k.close();
}
ok(sizes.all.n === 8 && sizes.lite.n === 4 && sizes.read.n === 3 && sizes['search,open'].n === 2, 'numero di tool per profilo', JSON.stringify(sizes));
ok(sizes.read.chars * 2 < sizes.all.chars, `profilo read piu' leggero (${sizes.read.chars} vs ${sizes.all.chars} caratteri)`);
log.push('   definizioni (caratteri): ' + Object.entries(sizes).map(([k, s]) => `${k}=${s.chars}`).join(' · '));

srv.close();
console.log(log.join('\n'));
console.log(`\nv0.5.8: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
