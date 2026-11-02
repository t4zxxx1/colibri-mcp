// Novita' 0.5.9: browser che non si blocca (ripristino e timeout), schede sulle pagine di categoria, prezzo
// totale / di riferimento / sconti condizionati, ordinamento e filtro delle schede, campi di una scheda tecnica,
// letture di altri URL in parallelo con cache, avvisi di coerenza, URL sbagliati e blocchi riconosciuti,
// parametri di tracciamento tolti.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP, TEST_ENV } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { within, BROKEN, cardsOut, fieldOf } from '../extension/server/lib/session.js';

fs.mkdirSync(TMP, { recursive: true });
const root = path.join(TMP, 'v059');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const srv = await serve();
const port = srv.address().port;
const base = 'http://127.0.0.1:' + port;
const base2 = 'http://localhost:' + port;
let pass = 0;
let fail = 0;
const log = [];
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 1800) : ''}`);
};

// ---------- unita' ----------
let t0 = Date.now();
const late = await within(new Promise((r) => setTimeout(r, 5000)), 200, 'pagina non risponde').catch((e) => e.message);
ok(late === 'pagina non risponde' && Date.now() - t0 < 1500 && BROKEN.test(late), 'within: una chiamata appesa finisce entro il limite (e conta come scheda bloccata)');
ok(BROKEN.test('page.goto: No frame with given id found') && !BROKEN.test('net::ERR_NAME_NOT_RESOLVED'), 'errore di frame riconosciuto, errori di rete no');
const R = { total: 3, sel: 'div.x', items: [{ row: 'A nero', p: 10, t: 15 }, { row: 'B bianco', p: 8, t: 30 }, { row: 'C nero', p: 5, t: null }] };
let u = cardsOut(R, { sort: 'price' });
ok(u.split('\n')[1] === 'A nero' && u.split('\n')[3] === 'C nero', 'cards: ordinamento per totale, senza prezzo in fondo', u);
u = cardsOut(R, { filter: 'nero', maxPrice: 20 });
ok(/di 1 \(filtrate da 3\)/.test(u) && u.includes('A nero') && !u.includes('C nero'), 'cards: filtro per parola + prezzo massimo', u);
u = cardsOut(R, { filter: '-nero' });
ok(u.includes('B bianco') && !u.includes('A nero'), 'cards: -parola esclude', u);
ok(cardsOut(R, { maxPrice: 1 }).startsWith('nessuna scheda corrisponde su 3'), 'cards: nessun risultato detto in una riga');
const D = { title: 'x', pairs: [['Classe di efficienza energetica', 'A'], ['Larghezza', '60 cm'], ['Altezza', '85 cm'], ['Profondità', '55 cm'], ['Colore', 'Bianco']], price: { price: 449, ship: 0, tot: 449, ref: 599, refKind: 'consigliato', cond: [] } };
ok(fieldOf(D, 'classe energetica') === 'A' && fieldOf(D, 'colore') === 'Bianco', 'fields: etichetta contenuta o simile');
ok(fieldOf(D, 'dimensioni') === 'L 60 cm x A 85 cm x P 55 cm', 'fields: dimensioni composte da larghezza/altezza/profondita', fieldOf(D, 'dimensioni'));
ok(/^449,00€ \(sped gratis\) \| rif 599,00€ consigliato -25%/.test(fieldOf(D, 'prezzo')), 'fields: prezzo con totale e riferimento', fieldOf(D, 'prezzo'));
ok(fieldOf(D, 'peso') === null, 'fields: chiave assente = null');

const c = await connect({ CB_PROFILE_DIR: path.join(root, 'prof'), CB_HUMAN_WAIT: '0', CB_SEARCH_URL: base + '/search-ddg.html?q={q}' });

// 1. pagina di categoria a griglia (2 prodotti per riga) + prezzi
await c.call('browse_open', { url: base + '/categoria.html', rows: false });
let r = (await c.call('browse_read', { mode: 'cards', links: true })).text;
const L = r.split('\n');
ok(/^schede 1-6 di 6 /.test(L[0]), 'categoria a griglia: 6 prodotti (non le 3 righe della griglia)', r);
const row = (s) => L.find((l) => l.includes(s)) || '';
ok(!/tot 399/.test(row('Samsung')) && /Spedizione gratuita/.test(row('Samsung')) && /rif 579,90€ consigliato -31% \(non e' un prezzo di vendita\)/.test(row('Samsung')), 'prezzo consigliato separato dal prezzo; spedizione gratuita senza totale ripetuto', row('Samsung'));
ok(/tot 378,90€ \(sped 29,90€\)/.test(row('LG')), 'totale = prezzo + spedizione', row('LG'));
ok(/tot 169,80€ \(sped 84,90€\)/.test(row('Bosch')), '"84,90 € + Sped. 84,90 €" in un solo elemento', row('Bosch'));
ok(/rif 1\.?200,00€ barrato -75% ⚠ sconto non plausibile/.test(row('Candy')), 'barrato fuori scala: avviso sconto non plausibile', row('Candy'));
ok(/cond:"10% extra in carrello" non confermato/.test(row('Hoover')) && /tot 298,90€/.test(row('Hoover')) && !/\| 10% extra in carrello \|/.test(row('Hoover')), 'sconto condizionato in un campo a parte, non nel prezzo', row('Hoover'));
ok(row('Samsung').includes('url:/scheda.html?id=1'), 'link della scheda', row('Samsung'));
r = (await c.call('browse_read', { mode: 'cards', sort: 'price', max: 3 })).text;
ok(/per prezzo totale crescente/.test(r) && /Bosch/.test(r.split('\n')[1]) && /Beko/.test(r.split('\n')[2]), 'sort:"price" sul totale (Bosch 169,80 prima di Beko 268,90)', r);
r = (await c.call('browse_read', { mode: 'cards', filter: 'bianca -bosch', maxPrice: 300 })).text;
ok(/di 2 \(filtrate da 6\)/.test(r) && r.includes('Hoover') && r.includes('Beko') && !r.includes('Bosch'), 'filter + maxPrice: solo le schede utili', r);
r = (await c.call('browse_do', { steps: [{ read: 'cards', sort: '-price', max: 1 }], view: 'none' })).text;
ok(/Samsung/.test(r) && /decrescente/.test(r), 'browse_do read cards con sort', r);

// 2. scheda tecnica: solo i campi chiesti, e coerenza fra due siti
await c.call('browse_open', { url: base + '/scheda.html', rows: false });
r = (await c.call('browse_read', { mode: 'fields', query: 'classe energetica, dimensioni, colore, prezzo, capacità di carico, peso' })).text;
ok(r.includes('classe energetica: A') && r.includes('dimensioni: L 60 cm x A 85 cm x P 55 cm') && r.includes('colore: Bianco') && r.includes('capacità di carico: 9 kg') && r.includes('peso: non trovato'), 'fields: valori della scheda tecnica', r);
ok(/prezzo: 449,00€ \(sped gratis\) \| rif 599,00€ consigliato/.test(r), 'fields: prezzo del prodotto (non i prezzi nella pagina)', r);
ok(r.length < 400, `fields: risposta corta (${r.length} caratteri)`, r);
r = (await c.call('browse_read', { url: base2 + '/scheda2.html', mode: 'fields', query: 'classe energetica, colore' })).text;
ok(r.includes('classe energetica: B') && /⚠ classe energetica: "B" qui, "A" su 127\.0\.0\.1/.test(r) && !/⚠ colore/.test(r), 'avviso di coerenza: stesso modello, valore diverso su un altro sito', r);
r = (await c.call('browse_view', {})).text;
ok(r.includes('Samsung WW90T534DAW lavatrice'), 'browse_read {url}: la pagina attiva non cambia', r.slice(0, 300));

// 3. cache e letture in parallelo
t0 = Date.now();
r = (await c.call('browse_read', { url: base2 + '/scheda2.html', mode: 'fields', query: 'colore' })).text;
ok(r.includes('(dalla cache)') && Date.now() - t0 < 800, `pagina appena letta servita dalla cache (${Date.now() - t0} ms)`, r);
t0 = Date.now();
const par = await Promise.all([
  c.call('browse_read', { url: base + '/slow?ms=1500', mode: 'text' }),
  c.call('browse_read', { url: base2 + '/slow?ms=1500', mode: 'text' }),
  c.call('browse_search', { query: 'treni' }),
]);
const dt = Date.now() - t0;
ok(par.every((x) => !x.isError) && par[0].text.includes('ok dopo 1500') && dt < 4200, `due letture e una ricerca in parallelo (${dt} ms, in serie > 4500)`, par.map((x) => x.text.slice(0, 120)).join('\n'));
r = (await c.call('browse_read', { url: base + '/categoria.html', mode: 'cards', maxPrice: 300 })).text;
ok(/filtrate da 6/.test(r) && !/\[e\d+/.test(r), 'cards da un altro URL: filtrate, senza ref (scheda di sfondo)', r);
r = (await c.call('browse_view', {})).text;
ok(r.includes('Samsung WW90T534DAW lavatrice'), 'dopo ricerca e letture la pagina attiva e\' ancora quella', r.slice(0, 200));

// 4. pagina che si ricarica da sola e disegna l'elenco in ritardo (idealo)
r = (await c.call('browse_open', { url: base + '/ricarica.html', rows: false })).text;
ok(!/errore/.test(r), 'pagina che si ricarica da sola: apertura senza errori', r);
r = (await c.call('browse_read', { mode: 'cards' })).text;
ok(/^schede 1-5 di 5/.test(r) && r.includes('110,00€') === false && r.includes('110,00 €'), 'elenco disegnato dopo la ricarica letto come schede', r);

// 5. URL indovinato (404) e ricerca con il campo del sito
r = (await c.call('browse_open', { url: base + '/nf-lavatrici-samsung', rows: false })).text;
ok(/HTTP 404: pagina inesistente \(URL indovinato o scaduto\)\. cerca dal sito: browse_open \{url:"http:\/\/127\.0\.0\.1:\d+", search:"testo"\} o il campo e\d+/.test(r), '404 segnalato con il modo giusto per cercare', r);
r = (await c.call('browse_open', { url: base + '/nf-x', search: 'lavatrice samsung' })).text;
ok(/cercato "lavatrice samsung" con il campo del sito; modello di ricerca salvato: http:\/\/127\.0\.0\.1:\d+\/cerca\.html\?q=\{q\}/.test(r) && r.includes('Risultati per lavatrice samsung'), 'search: usa il campo del sito e salva il modello di URL', r);
r = (await c.call('browse_open', { url: base + '/nf-y', rows: false })).text;
ok(/modello di ricerca di 127\.0\.0\.1:\d+: http:\/\/127\.0\.0\.1:\d+\/cerca\.html\?q=\{q\}/.test(r), 'al 404 successivo propone il modello salvato', r);

// 6. blocco del sito (non una verifica da risolvere)
t0 = Date.now();
r = (await c.call('browse_open', { url: base + '/blocco.html', rows: false })).text;
ok(/ha bloccato il browser \(non e' una verifica da risolvere\)/.test(r) && /CB_MODE=cdp/.test(r) && Date.now() - t0 < 8000, 'blocco Cloudflare riconosciuto subito, senza pausa', r);

// 7. parametri di tracciamento
r = (await c.call('browse_open', { url: base + '/categoria.html?utm_source=news&page=2&gclid=abc&gbraid=x1', rows: false })).text;
ok(/tolti i parametri di tracciamento: utm_source, gclid, gbraid/.test(r), 'utm_*, gclid, gbraid tolti', r);
r = (await c.call('browse_do', { steps: [{ tab: 'list' }], view: 'none' })).text;
ok(/categoria\.html\?page=2(?!&)/.test(r) || /page=2/.test(r), 'gli altri parametri restano', r);
await c.close();

const c2 = await connect({ CB_PROFILE_DIR: path.join(root, 'prof2'), CB_HUMAN_WAIT: '0', CB_STRIP_TRACKING: 'false' });
r = (await c2.call('browse_open', { url: base + '/categoria.html?utm_source=news', rows: false })).text;
ok(!/tolti/.test(r), 'CB_STRIP_TRACKING=false: URL lasciato com\'e\'', r);
await c2.close();

// 8. scheda in crash (renderer morto): ripristino sulla stessa pagina
{
  const { Session, loadConfig } = await import('../extension/server/lib/session.js');
  const S = new Session(loadConfig({ ...process.env, ...TEST_ENV, CB_PROFILE_DIR: path.join(root, 'prof3'), CB_HUMAN_WAIT: '0' }));
  await S.open(base + '/scheda.html', { rows: false });
  const dead = S.page;
  const cdp = await dead.context().newCDPSession(dead);
  cdp.send('Page.crash').catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  t0 = Date.now();
  const v = await within(S.view({}), 20000, 'appeso').catch((e) => 'ERR ' + e.message);
  ok(S.page !== dead && v.includes('Samsung WW90T534DAW lavatrice') && Date.now() - t0 < 15000, `scheda in crash: la chiamata successiva la riapre sulla stessa pagina, senza restare appesa (${Date.now() - t0} ms)`, v.slice(0, 200));
  await S.close();
}

// 9. scheda bloccata (renderer in un ciclo infinito): l'elenco schede risponde subito, gli altri passi entro il loro limite
{
  const c3 = await connect({ CB_PROFILE_DIR: path.join(root, 'prof4'), CB_HUMAN_WAIT: '0' });
  await c3.call('browse_open', { url: base + '/appesa.html?hang=1', rows: false });
  await new Promise((r) => setTimeout(r, 2500));
  t0 = Date.now();
  const pend = c3.call('browse_do', { steps: [{ find: 'Continua' }], view: 'none' });
  await new Promise((r) => setTimeout(r, 300));
  const t1 = Date.now();
  r = (await c3.call('browse_do', { steps: [{ tab: 'list' }] })).text;
  const dt = Date.now() - t1;
  ok(/^ok 1\/1 · schede: 1\* .*appesa\.html/.test(r) && dt < 5000, `tab:"list" con una scheda bloccata e una chiamata appesa in coda: risposta in ${dt} ms`, r);
  r = (await pend).text;
  const dt2 = Date.now() - t0;
  ok(dt2 < 60000 && /oltre 23 s|ripeti il passo|non risponde/.test(r), `passo su scheda bloccata: errore dopo ${Math.round(dt2 / 1000)} s (limite dai passi, non minuti)`, r);
  await c3.close();
}

srv.close();
console.log(log.join('\n'));
console.log(`\nv059: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
