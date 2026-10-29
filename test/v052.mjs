// Miglioramenti 0.5.2 dall'uso reale: Chrome dell'utente mai chiuso (CDP), avvio guidato del Chrome reale,
// rilevamento dei blocchi piu' preciso, !c meno invadente, ref scaduti recuperati, schede, PDF, attesa "idle".
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { findChrome, cdpAlive } from '../extension/server/lib/realchrome.js';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killChrome = async (url) => {
  try {
    const b = await chromium.connectOverCDP(url, { timeout: 5000 });
    const s = await b.newBrowserCDPSession();
    await s.send('Browser.close').catch(() => {});
  } catch {}
  for (let k = 0; k < 20 && (await cdpAlive(url, 300)); k++) await sleep(200);
};
const tabsOf = async (url) => {
  const r = await fetch(url + '/json/list');
  return (await r.json()).filter((t) => t.type === 'page').map((t) => t.url);
};

const dl = prof('dl-v052');
fs.mkdirSync(dl, { recursive: true });
const c = await connect({ CB_PROFILE_DIR: prof('prof-v052'), CB_DOWNLOADS_DIR: dl, CB_HUMAN_WAIT: '0' });

// ---------- punto 4: !c solo per invii veri ----------
let r = await c.call('browse_open', { url: base + '/v052.html' });
const row = (name) => r.text.split('\n').find((l) => l.includes(`"${name}`)) || '';
ok(!/!c/.test(row('Conferma passeggeri')), '!c: pulsante che apre un menu (aria-haspopup) senza conferma', row('Conferma passeggeri'));
ok(/!c/.test(row('Elimina account')) && /!c/.test(row('Invia prenotazione')), '!c: resta su eliminazione e invio del modulo', r.text);
let d = await c.call('browse_do', { steps: [{ click: 'Conferma passeggeri' }, { click: 'Remove passenger' }], view: 'diff' });
ok(has(d.text, 'ok 2/2') && !has(d.text, 'BLOCCATO'), '!c: "Remove passenger" di un contatore senza conferma', d.text);
ok(has(d.text, 'Conferma passeggeri: 2'), 'diff: il nuovo valore del contatore si vede subito', d.text);

// ---------- punto 5: ref scaduto in browse_do ----------
r = await c.call('browse_view', {});
const ref = (/(e\d+) btn "Data partenza"/.exec(r.text) || [])[1];
d = await c.call('browse_do', { steps: [{ click: 'Aggiorna' }, { click: ref }, { find: 'Data scelta' }], view: 'none' });
ok(ref && has(d.text, 'ok 3/3') && has(d.text, `${ref} scaduto →`) && has(d.text, 'Data scelta'), 'do: ref ricreato dalla pagina ritrovato per nome e ruolo', `${ref}\n${d.text}`);

// ---------- attesa "idle" + lettura a schede ----------
d = await c.call('browse_do', { steps: [{ click: 'Cerca treni' }, { wait: 'idle' }, { read: 'cards' }], view: 'none' });
ok(has(d.text, 'ok 3/3') && has(d.text, 'schede 1-4 di 4') && /08:30 \| → \| 11:02 \| 2 h 32 \| 0 cambi \| € 29,90/.test(d.text), 'read cards: un treno per riga (ora | arrivo | durata | cambi | prezzo)', d.text);
const tCards = d.text.length;
const tText = (await c.call('browse_read', { mode: 'text' })).text.length;
ok(tCards < tText * 1.2, `read cards compatto (${tCards} caratteri, testo ${tText})`);

// ---------- punto 3: blocchi decisi da cio' che si vede + cf_clearance ----------
r = await c.call('browse_open', { url: base + '/title-moment.html' });
ok(!/verifica/i.test(r.text), 'titolo con "Just a moment" ma pagina piena di contenuto: nessuna pausa', r.text.slice(0, 400));
r = await c.call('browse_open', { url: base + '/cf-rich.html' });
ok(has(r.text, 'verifica Cloudflare'), 'resto di Cloudflare visibile senza cookie di superamento: verifica segnalata', r.text.slice(0, 300));
ok(/CB_MODE=cdp/.test(r.text), 'verifica bloccata: indica la modalita\' Chrome reale', r.text.slice(0, 400));
r = await c.call('browse_open', { url: base.replace('127.0.0.1', 'localhost') + '/cf-rich.html?ok' });
ok(!/verifica/i.test(r.text) && has(r.text, 'Notizie del giorno'), 'cookie cf_clearance + contenuto vero: nessuna nuova pausa', r.text.slice(0, 300));

// ---------- PDF ----------
r = await c.call('browse_open', { url: base + '/biglietto.pdf' });
ok((has(r.text, 'download salvato') && has(r.text, 'PDF, 1 pag.')) || has(r.text, 'documento PDF: testo con browse_read mode "pdf"'), 'link a un PDF: scaricato o aperto con indicazione della lettura (non piu\' "Download is starting")', r.text);
r = await c.call('browse_read', { mode: 'pdf' });
ok(has(r.text, 'Partenza 08:30 arrivo 11:02') && has(r.text, 'Totale EUR 59,90'), 'browse_read pdf: testo dell\'ultimo PDF scaricato', r.text);
r = await c.call('browse_read', { mode: 'pdf', query: base + '/biglietto.pdf' });
ok(has(r.text, 'Biglietto treno Wien Hbf'), 'browse_read pdf da URL', r.text);
r = await c.call('browse_read', { mode: 'pdf', query: path.join(TMP, 'fuori.pdf') });
ok(r.isError && has(r.text, 'solo PDF nella cartella download'), 'browse_read pdf: nessun accesso a file fuori dai download', r.text);
await c.close();

// ---------- punto 1: modalita' CDP, il Chrome dell'utente resta aperto ----------
const exe = findChrome(process.env.TEST_CHROME);
if (!exe) ok(false, 'Chrome non trovato per i test CDP');
else {
  const url1 = 'http://127.0.0.1:9334';
  const user = spawn(exe, ['--remote-debugging-port=9334', `--user-data-dir=${prof('cdp-user')}`, '--headless=new', '--no-first-run', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), base + '/title-moment.html'], { stdio: 'ignore' });
  for (let k = 0; k < 40 && !(await cdpAlive(url1, 300)); k++) await sleep(250);
  const c1 = await connect({ CB_MODE: 'cdp', CB_CDP_URL: url1 });
  r = await c1.call('browse_open', { url: base + '/v052.html' });
  ok(has(r.text, 'Prenota treno'), 'cdp: collegato al Chrome dell\'utente', r.text.slice(0, 200));
  // la pagina apre una scheda propria (popup) mentre Colibri agisce
  await c1.call('browse_do', { steps: [{ goto: base + '/cf-rich.html?ok' }], view: 'none' });
  const before = await tabsOf(url1);
  await c1.close();
  await sleep(1500);
  const alive = await cdpAlive(url1);
  const after = alive ? await tabsOf(url1) : [];
  ok(alive, 'cdp: chiudendo Colibri (riconnessione /mcp) Chrome resta aperto');
  ok(after.some((u) => u.includes('title-moment')) && !after.some((u) => u.includes('cf-rich')), 'cdp: chiusa solo la scheda di Colibri, quella dell\'utente resta', `prima: ${before.join(' , ')}\ndopo: ${after.join(' , ')}`);
  // riconnessione: riusa il Chrome gia' aperto
  const c2 = await connect({ CB_MODE: 'cdp', CB_CDP_URL: url1 });
  r = await c2.call('browse_open', { url: base + '/v052.html' });
  ok(has(r.text, 'Prenota treno'), 'cdp: dopo la riconnessione lavora nello stesso Chrome', r.text.slice(0, 200));
  await c2.close();
  await killChrome(url1);
  user.kill();

  // avvio guidato: CB_MODE=cdp senza Chrome in ascolto -> Colibri avvia il Chrome reale, staccato
  // (finestra visibile: saltato in CI, dove non c'e' un display)
  if (!process.env.CI) {
  const url2 = 'http://127.0.0.1:9335';
  const c3 = await connect({ CB_MODE: 'cdp', CB_CDP_URL: url2, CB_REAL_PROFILE_DIR: prof('real-chrome'), CB_EXTRA_ARGS: '' });
  r = await c3.call('browse_do', { steps: [{ goto: base + '/v052.html' }], view: 'none' });
  ok(has(r.text, 'avviato Chrome reale'), 'cdp: senza Chrome in ascolto Colibri avvia il Chrome reale', r.text);
  await c3.close();
  await sleep(1500);
  ok(await cdpAlive(url2), 'Chrome reale avviato da Colibri sopravvive alla chiusura del server MCP');
  await killChrome(url2);
  }
}

srv.close();
console.log(log.join('\n'));
console.log(`\nv0.5.2: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
