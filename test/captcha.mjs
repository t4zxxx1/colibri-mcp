// CAPTCHA e verifiche anti-bot: Colibri non le aggira, si mette in pausa finche' non sono superate e poi riprende.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';

fs.mkdirSync(TMP, { recursive: true });
for (const d of ['prof-captcha', 'prof-captcha2']) fs.rmSync(path.join(TMP, d), { recursive: true, force: true });
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
const c = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-captcha') });
if (process.env.DBG) { const o = c.call; c.call = async (n, a) => { console.error('>', n, JSON.stringify(a).slice(0, 120)); const r = await o(n, a); console.error('<', r.ms | 0, r.text.slice(0, 200).replace(/\n/g, ' | ')); return r; }; }

// 1. muro "Just a moment" che si supera da solo: browse_open aspetta e restituisce la pagina vera
let r = await c.call('browse_open', { url: base + '/cf-wall.html' });
ok(has(r.text, 'verifica Cloudflare superata') && has(r.text, 'Benvenuto nel sito') && !has(r.text, 'Just a moment'), 'open: attende la verifica a pagina intera e mostra la pagina di destinazione', `${r.ms | 0} ms\n${r.text}`);

// 2. la verifica compare dopo un clic: i passi successivi aspettano
await c.call('browse_open', { url: base + '/cf-start.html' });
r = await c.call('browse_do', { steps: [{ click: 'Area riservata' }, { find: 'Contenuto protetto' }], view: 'none' });
ok(has(r.text, 'ok 2/2') && has(r.text, 'superata') && has(r.text, 'Contenuto protetto disponibile'), 'do: dopo un clic che porta a una verifica attende e continua i passi', r.text);

// 3. CAPTCHA nel modulo: l'invio aspetta il token, poi procede
await c.call('browse_open', { url: base + '/turnstile.html' });
r = await c.call('browse_do', { steps: [{ fill: 'Nome', text: 'Ada' }, { click: 'Invia messaggio', confirm: true }, { find: 'Modulo inviato' }], view: 'none' });
ok(has(r.text, 'ok 3/3') && has(r.text, 'Modulo inviato con token') && has(r.text, 'Turnstile superata'), 'click di invio: aspetta che il CAPTCHA del modulo sia risolto', r.text);

// 4. vista: il CAPTCHA nel modulo e' segnalato con il tipo
r = await c.call('browse_open', { url: base + '/turnstile.html?ms=0' });
ok(/CAPTCHA Turnstile: all'invio/.test(r.text), 'vista: CAPTCHA del modulo indicato con il tipo', r.text);

// 5. browse_task: stesso comportamento all'invio
await c.call('browse_open', { url: base + '/turnstile.html?ms=1500' });
r = await c.call('browse_task', { params: { Nome: 'Ada' }, submit: 'Invia messaggio', confirm: true, view: 'none' });
r = await c.call('browse_do', { steps: [{ find: 'Modulo inviato' }], view: 'none' });
ok(has(r.text, 'Modulo inviato con token'), 'browse_task: invio dopo la risoluzione del CAPTCHA', r.text);

// 6. nessun falso allarme: badge reCAPTCHA invisibile e testo che parla di captcha
r = await c.call('browse_open', { url: base + '/recaptcha-badge.html' });
ok(!/CAPTCHA|VERIFICA|verifica/.test(r.text.replace(/come funziona un captcha/i, '')), 'nessun falso allarme con reCAPTCHA invisibile', r.text);
r = await c.call('browse_do', { steps: [{ fill: 'Cerca prodotto', text: 'scarpe' }, { press: 'Enter', confirm: true }], view: 'none' });
ok(has(r.text, 'ok 2/2') && r.ms < 8000, 'Enter in un modulo con reCAPTCHA invisibile non aspetta', `${r.ms | 0} ms\n${r.text}`);
await c.close();

// 7. verifica che non si supera: attesa breve configurabile, passi non eseguiti, istruzioni per l'agente
const c2 = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-captcha2'), CB_HUMAN_WAIT: '2' });
r = await c2.call('browse_open', { url: base + '/cf-wall.html?stay' });
ok(has(r.text, 'VERIFICA Cloudflare') && has(r.text, 'browse_view') && r.ms < 9000, 'verifica non superata: segnalata con le istruzioni, attesa limitata', `${r.ms | 0} ms\n${r.text}`);
r = await c2.call('browse_do', { steps: [{ click: 'Checking your browser' }], view: 'none' });
ok(has(r.text, 'ok 0/1') && has(r.text, 'fermo'), 'do: con la pagina bloccata i passi non vengono eseguiti', r.text);
await c2.call('browse_open', { url: base + '/turnstile.html?ms=0' });
r = await c2.call('browse_do', { steps: [{ click: 'Invia messaggio', confirm: true }], view: 'none' });
ok(has(r.text, 'BLOCCATO') && has(r.text, 'Turnstile'), 'invio con CAPTCHA non risolto: bloccato, il modulo non parte', r.text);
r = await c2.call('browse_do', { steps: [{ find: 'Modulo inviato' }], view: 'none' });
ok(!has(r.text, 'Modulo inviato SENZA'), 'il modulo non e\' stato inviato senza token', r.text);
await c2.close();

// 8. componenti Salesforce Lightning/LWC: getElementById vietato sulle ShadowRoot non deve rompere la lettura
const c3 = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-captcha') });
r = await c3.call('browse_open', { url: base + '/locker.html' });
ok(!r.isError && has(r.text, '"Nome"') && has(r.text, '"Cognome"') && has(r.text, '"Descrizione"'), 'ShadowRoot con getElementById vietato: campi letti con il loro nome', r.text);
r = await c3.call('browse_task', { params: { Nome: 'Mario', Cognome: 'Rossi', Descrizione: 'prova' }, view: 'none' });
ok(has(r.text, '3/3 impostati'), 'ShadowRoot con getElementById vietato: compilazione', r.text);
await c3.close();

srv.close();
console.log(log.join('\n'));
console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
