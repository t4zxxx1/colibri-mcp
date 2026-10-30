// Benchmark sugli scenari reali (Vinted, Amazon/Wikipedia, calendario Meliá, codice sconto) riprodotti in locale:
// chiamate e token per ottenere la stessa informazione, versione attuale contro un'altra (percorso di index.js).
// node test/bench-pages.mjs [altro/index.js ...]
import path from 'node:path';
import { connect, TMP, SERVER_ENTRY } from './mcp-client.mjs';
import { serve } from './server.mjs';

const tok = (s) => Math.ceil((s || '').length / 3.6);
const SHOT = 900; // uno screenshot JPEG della finestra
const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
const entries = [SERVER_ENTRY, ...process.argv.slice(2)];

async function bench(entry) {
  const c = await connect({ CB_PROFILE_DIR: path.join(TMP, 'bench-pages-' + entries.indexOf(entry)), CB_HUMAN_WAIT: '0' }, entry);
  const ver = c.client.getServerVersion().version;
  const res = {};
  const run = async (name, fn) => {
    const from = c.calls.length;
    const extra = { tokens: 0, calls: 0 };
    const okv = await fn(extra);
    const cs = c.calls.slice(from);
    res[name] = { calls: cs.length + extra.calls, tokens: cs.reduce((x, k) => x + tok(k.text), 0) + extra.tokens, ok: okv };
  };

  // Vinted: 8 annunci con il loro link
  await run('schede con link (Vinted)', async () => {
    await c.call('browse_open', { url: base + '/annunci.html', rows: false });
    let r = (await c.call('browse_read', { mode: 'cards', links: true })).text;
    if (/url:/.test(r)) return (r.match(/url:\/annunci/g) || []).length === 8;
    // senza link nelle schede: un describe per scheda
    const refs = [...r.matchAll(/→(e\d+)/g)].map((m) => m[1]);
    let n = 0;
    for (const ref of refs) if (/href/.test((await c.call('browse_read', { mode: 'describe', ref })).text)) n++;
    return n === 8;
  });

  // Amazon/Wikipedia: il testo della recensione
  await run('testo della pagina (recensione)', async () => {
    await c.call('browse_open', { url: base + '/articolo.html', rows: false });
    const r = (await c.call('browse_read', { mode: 'text' })).text;
    return /Paragrafo 6/.test(r);
  });

  // Meliá: apertura del calendario
  await run('calendario in una finestra (Meliá)', async () => {
    await c.call('browse_open', { url: base + '/calendario.html', rows: false });
    const r = (await c.call('browse_do', { steps: [{ click: { name: 'Date' } }] })).text;
    return /"15"|"1"\.\."31"/.test(r);
  });

  // codice sconto: verde o rosso?
  await run('esito del codice sconto', async (extra) => {
    await c.call('browse_open', { url: base + '/stato.html', rows: false });
    const r = (await c.call('browse_do', { steps: [{ fill: { name: 'Codice sconto' }, text: 'SCONTO10' }, { click: { name: 'Usa codice' }, confirm: true }] })).text;
    if (/applicato/.test(r)) return true;
    // senza stato nel testo serve uno screenshot per vederlo
    extra.calls++;
    extra.tokens += SHOT;
    return true;
  });

  const defs = JSON.stringify((await c.client.listTools()).tools).length + (c.client.getInstructions() || '').length;
  await c.close();
  return { ver, res, defs: Math.ceil(defs / 3.6) };
}

const out = [];
for (const e of entries) out.push(await bench(e));
srv.close();
const names = Object.keys(out[0].res);
console.log('scenario'.padEnd(36) + out.map((o) => ('Colibri ' + o.ver).padStart(22)).join(''));
for (const n of names) console.log(n.padEnd(36) + out.map((o) => `${o.res[n].calls} chiam. ~${o.res[n].tokens} tok${o.res[n].ok ? '' : ' ✗'}`.padStart(22)).join(''));
const sum = (o, k) => names.reduce((x, n) => x + o.res[n][k], 0);
console.log('totale'.padEnd(36) + out.map((o) => `${sum(o, 'calls')} chiam. ~${sum(o, 'tokens')} tok`.padStart(22)).join(''));
console.log('definizioni per turno'.padEnd(36) + out.map((o) => `~${o.defs} tok`.padStart(22)).join(''));
