// Banco di prova su un compito reale ripetuto: cerca treni Wien Hbf → Salzburg Hbf il 12/11/2026 dalle 18:00
// e trova il piu' economico. Ogni versione usa il flusso migliore che supporta; 3 ripetizioni per flusso.
// Uso: node test/bench-task.mjs [percorso/index.js di una versione da confrontare ...]
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP, SERVER_ENTRY } from './mcp-client.mjs';
import { serve } from './server.mjs';

const RUNS = +(process.env.RUNS || 3);
const servers = [...process.argv.slice(2), SERVER_ENTRY];
const srv = await serve();
const url = 'http://127.0.0.1:' + srv.address().port + '/orari.html';
const tok = (s) => Math.ceil(s.length / 3.6);
const good = (t) => /21:39/.test(t) && /9,90/.test(t);

async function version(entry) {
  const c = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-bench-v'), CB_HUMAN_WAIT: '0' }, entry);
  const v = c.client.getServerVersion().version;
  const tools = (await c.client.listTools()).tools;
  const defs = JSON.stringify(tools).length + (c.client.getInstructions() || '').length;
  await c.close();
  return { v, defs, n: tools.length };
}

function flows(v) {
  const old = v === '0.5.0';
  const read = old ? { read: 'text', max: 1500 } : { read: 'cards' };
  const wait = old ? { waitFor: 'Seleziona' } : { wait: 'idle' };
  const steps = [
    { type: 'Da', text: 'Wien' }, { pick: 'Wien Hbf' },
    { type: 'A', text: 'Salzburg' }, { pick: 'Salzburg Hbf' },
    { fill: 'Data di andata', text: '2026-11-12' }, { select: 'Ora di partenza', option: '18:00' },
    { click: 'Cerca' }, wait, read,
  ];
  const params = { da: 'Wien Hbf', a: 'Salzburg Hbf', 'data di andata': '12/11/2026', ora: '18:00' };
  const f = {
    'passi (open + do)': async (c) => {
      await c.call('browse_open', { url });
      return c.call('browse_do', { steps });
    },
    'compito (browse_task)': async (c) => c.call('browse_task', { url, params, submit: 'Cerca', read: old ? 'text' : 'cards' }),
  };
  if (!old && v >= '0.5.5' && process.env.BENCH_NEW !== '0') {
    f['passi, apertura leggera'] = async (c) => {
      await c.call('browse_open', { url, rows: false });
      // read attende da solo la fine delle richieste: nessun passo wait
      return c.call('browse_do', { steps: steps.filter((s) => !s.wait) });
    };
  }
  return f;
}

const out = [];
for (const entry of servers) {
  const info = await version(entry);
  out.push(`\n== Colibri ${info.v}: ${info.n} tool, definizioni ~${tok('x'.repeat(info.defs))} token per turno`);
  for (const [name, fn] of Object.entries(flows(info.v))) {
    const res = [];
    for (let k = 0; k < RUNS; k++) {
      const c = await connect({ CB_PROFILE_DIR: path.join(TMP, 'prof-bench-' + k), CB_HUMAN_WAIT: '0' }, entry);
      await c.call('browse_stats', {}).catch(() => {});
      c.calls.length = 0;
      let last;
      try {
        last = await fn(c);
      } catch (e) {
        last = { text: 'ECCEZIONE ' + e.message, isError: true };
      }
      const stats = (await c.call('browse_stats', {})).text;
      const calls = c.calls.slice(0, -1);
      res.push({ calls: calls.length, chars: calls.reduce((s, x) => s + x.text.length, 0), ms: calls.reduce((s, x) => s + x.ms, 0), ok: good(last.text) && !last.isError, stats, last: last.text });
      await c.close();
    }
    const avg = (k) => res.reduce((s, r) => s + r[k], 0) / res.length;
    out.push(`${name}: ${res.filter((r) => r.ok).length}/${RUNS} corretti · ${avg('calls')} chiamate · ~${Math.round(avg('chars') / 3.6)} token · ${(avg('ms') / 1000).toFixed(2)} s (${res.map((r) => (r.ms / 1000).toFixed(2)).join(' / ')})`);
    if (process.env.BENCH_SHOW) out.push('   ultima risposta:\n   ' + res[0].last.replace(/\n/g, '\n   ').slice(0, 2500), '   stats: ' + res[0].stats.split('\n')[0]);
    if (!res[0].ok) out.push('   ERRATO:\n   ' + res[0].last.replace(/\n/g, '\n   ').slice(0, 1500));
  }
}
srv.close();
console.log(out.join('\n'));
fs.mkdirSync(TMP, { recursive: true });
