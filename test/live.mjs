// Prove su siti reali (rete necessaria, non in CI): npm run test:live
// Flussi ripetuti dell'uso quotidiano: ricerca web, lettura pagina, PDF pubblico, modulo vero con invio,
// sito grande senza falsi blocchi. Le pagine reali cambiano: un errore qui va guardato, non e' per forza un difetto.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';

fs.mkdirSync(TMP, { recursive: true });
const prof = path.join(TMP, 'prof-live');
fs.rmSync(prof, { recursive: true, force: true });
let pass = 0;
let fail = 0;
const log = [];
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 1200) : ''}`);
};
const has = (t, s) => t.includes(s);

try {
  await fetch('https://example.com', { signal: AbortSignal.timeout(8000) });
} catch {
  console.log('rete non disponibile: prove live saltate');
  process.exit(0);
}

const c = await connect({ CB_PROFILE_DIR: prof, CB_HUMAN_WAIT: '0' });
const timed = async (name, args) => {
  const r = await c.call(name, args);
  return { ...r, info: `${Math.round(r.ms)} ms, ${r.text.length} caratteri` };
};

// ricerca web (DuckDuckGo HTML)
let r = await timed('browse_search', { query: 'playwright github microsoft', max: 5 });
const n = (r.text.match(/^\d+\. /gm) || []).length;
ok(!r.isError && n >= 3 && has(r.text, 'github.com'), `search reale: ${n} risultati, link reali (${r.info})`, r.text);
ok(!has(r.text, 'duckduckgo.com/l/'), 'search reale: nessun link di reindirizzamento', r.text);

// pagina statica
r = await timed('browse_open', { url: 'https://example.com' });
ok(has(r.text, 'Example Domain'), `example.com aperto (${r.info})`, r.text);

// PDF pubblico
r = await timed('browse_read', { mode: 'pdf', query: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' });
ok(/dummy pdf/i.test(r.text), `PDF pubblico letto (${r.info})`, r.text);

// modulo reale con invio (httpbin: echo dei dati inviati, nessun effetto)
r = await timed('browse_task', {
  url: 'https://httpbin.org/forms/post',
  params: { 'customer name': 'Mario Rossi', telephone: '3331234567', 'e-mail': 'mario@example.com', size: 'Medium', bacon: true, 'delivery time': '19:30', instructions: 'citofono Rossi' },
  submit: true,
  confirm: true,
  expect: 'Mario Rossi',
  view: 'none',
});
ok(/parametri: 7\/7/.test(r.text) && !r.isError, `httpbin: 7/7 campi (${r.info})`, r.text);
ok(/"custname": "Mario Rossi"/.test(r.text) || /atteso.*trovato|trovato/i.test(r.text) || has(r.text, 'Mario Rossi'), 'httpbin: invio verificato dalla risposta del server', r.text);

// sito grande: nessun falso blocco anti-bot
r = await timed('browse_open', { url: 'https://it.wikipedia.org/wiki/Trochilidae' });
ok(!/verifica|captcha|cloudflare/i.test(r.text.split('\n').slice(0, 3).join(' ')) && /Trochilidae|colibr/i.test(r.text), `Wikipedia: nessun falso blocco (${r.info})`, r.text.slice(0, 400));
r = await timed('browse_read', { mode: 'find', query: 'becco', max: 3 });
ok(!r.isError && has(r.text.toLowerCase(), 'becco'), `Wikipedia: find nel testo (${r.info})`, r.text);

await c.close();
console.log(log.join('\n'));
console.log(`\nlive: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
