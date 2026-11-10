// 0.5.12: collegamento al Chrome gia' aperto dell'utente (CB_MODE=attach, DevToolsActivePort) e lavoro nella
// scheda che sta guardando (CB_TAB=active), senza aprirne una nuova e senza rifare gli accessi.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { connect, TMP, SERVER_ENTRY } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { findChrome, cdpAlive, findRunningChrome } from '../extension/server/lib/realchrome.js';

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
const tabsOf = async (url) => {
  const r = await fetch(url + '/json/list');
  return (await r.json()).filter((t) => t.type === 'page').map((t) => t.url);
};

const exe = findChrome(process.env.TEST_CHROME);
if (!exe) ok(false, 'Chrome non trovato per i test di collegamento');
else {
  // il "Chrome di tutti i giorni": porta scelta da Chrome (0) e annotata in DevToolsActivePort nel profilo
  const dir = prof('attach-user');
  const user = spawn(exe, ['--remote-debugging-port=0', `--user-data-dir=${dir}`, '--headless=new', '--no-first-run', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), base + '/account.html'], { stdio: 'ignore' });
  let run = null;
  for (let k = 0; k < 80 && !run; k++) {
    await sleep(250);
    run = await findRunningChrome([dir]);
  }
  ok(!!run, 'DevToolsActivePort: trovato il Chrome gia\' aperto', dir);
  const http = `http://127.0.0.1:${run && run.port}`;

  // l'utente ha gia' fatto l'accesso e ha due schede aperte
  const me = await chromium.connectOverCDP(run.ws);
  const ctx = me.contexts()[0];
  const [acc] = ctx.pages();
  await acc.evaluate(() => (document.cookie = 'sess=mario; path=/'));
  await acc.reload();
  const other = await ctx.newPage();
  await other.goto(base + '/v052.html');
  await acc.bringToFront();
  const tabs0 = await tabsOf(http);

  // nessun Chrome con il debug attivo: errore immediato con le istruzioni
  let t0 = Date.now();
  const cx = await connect({ CB_MODE: 'attach', CB_USER_DATA_DIR: prof('attach-none'), CB_CDP_URL: 'http://127.0.0.1:9399' });
  let r = await cx.call('browse_view', {});
  ok(r.isError && has(r.text, 'chrome://inspect/#remote-debugging') && Date.now() - t0 < 15000, 'attach senza Chrome: errore rapido con le istruzioni', r.text);
  await cx.close();

  const c = await connect({ CB_MODE: 'attach', CB_USER_DATA_DIR: dir });
  r = await c.call('browse_view', {});
  ok(has(r.text, "collegato al tuo Chrome gia' aperto"), 'attach: collegato al Chrome dell\'utente', r.text.slice(0, 400));
  ok(has(r.text, 'Benvenuto Mario'), 'attach: lavora nella scheda che l\'utente sta guardando, con l\'accesso gia\' fatto', r.text.slice(0, 400));
  ok((await tabsOf(http)).length === tabs0.length, 'attach: nessuna scheda nuova aperta', (await tabsOf(http)).join(' , '));

  // l'utente passa all'altra scheda: tab:"active" la segue
  await other.bringToFront();
  r = await c.call('browse_do', { steps: [{ tab: 'active' }, { find: 'Prenota treno' }], view: 'none' });
  ok(has(r.text, 'ok 2/2') && has(r.text, 'v052.html') && has(r.text, 'Prenota treno'), 'tab:"active": passa alla scheda che l\'utente ha davanti', r.text);

  // la navigazione avviene nella scheda dell'utente e i cookie restano
  r = await c.call('browse_open', { url: base + '/account.html?di-nuovo' });
  ok(has(r.text, 'Benvenuto Mario'), 'browse_open nella scheda dell\'utente: stessi cookie, nessun nuovo accesso', r.text.slice(0, 300));
  ok((await tabsOf(http)).length === tabs0.length, 'browse_open non apre schede nuove', (await tabsOf(http)).join(' , '));

  await c.close();
  await sleep(1000);
  const after = (await cdpAlive(http)) ? await tabsOf(http) : [];
  ok(after.length === tabs0.length, 'chiudendo Colibri il Chrome e le schede dell\'utente restano', `prima: ${tabs0.join(' , ')}\ndopo: ${after.join(' , ')}`);

  // modalita' cdp: anche qui per default la scheda attiva, non una nuova
  await acc.bringToFront();
  const c2 = await connect({ CB_MODE: 'cdp', CB_CDP_URL: http });
  r = await c2.call('browse_view', {});
  ok(has(r.text, 'Benvenuto Mario') && (await tabsOf(http)).length === tabs0.length, 'cdp: scheda attiva dell\'utente per default (CB_TAB=active)', r.text.slice(0, 300));
  await c2.close();

  // CB_TAB=new: comportamento precedente, scheda propria chiusa all'uscita
  const c3 = await connect({ CB_MODE: 'attach', CB_USER_DATA_DIR: dir, CB_TAB: 'new' });
  r = await c3.call('browse_open', { url: base + '/v052.html?nuova' });
  const during = await tabsOf(http);
  await c3.close();
  await sleep(1000);
  ok(during.length === tabs0.length + 1 && (await tabsOf(http)).length === tabs0.length, 'CB_TAB=new: scheda propria, chiusa all\'uscita', during.join(' , '));

  // diagnostica da riga di comando
  let out = '';
  try {
    out = execFileSync(process.execPath, [SERVER_ENTRY, '--attach'], { env: { ...process.env, CB_USER_DATA_DIR: dir }, encoding: 'utf8' });
  } catch (e) {
    out = String(e.stdout || e.message);
  }
  ok(has(out, 'Chrome trovato') && has(out, 'CB_MODE=attach'), '--attach: segnala il Chrome pronto al collegamento', out);

  await me.close();
  try {
    const b = await chromium.connectOverCDP(http, { timeout: 5000 });
    const s = await b.newBrowserCDPSession();
    await s.send('Browser.close').catch(() => {});
  } catch {}
  user.kill();
}

srv.close();
console.log(log.join('\n'));
console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
