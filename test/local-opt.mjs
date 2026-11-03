// Script locale in browse_do (sandbox node:vm in un worker) e CB_CODE_MODE, contesto di sezione e trigrammi
// in browse_task, filtro locale in browse_read, titolo della card per i link generici, quiete di rete dopo le azioni.
import fs from 'node:fs';
import path from 'node:path';
import { connect, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { trigramDice, similarity } from '../extension/server/lib/engine.js';
import { runScript, capTokens } from '../extension/server/codemode.js';

fs.mkdirSync(TMP, { recursive: true });
const root = path.join(TMP, 'local-opt');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
let pass = 0;
let fail = 0;
const log = [];
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else fail++;
  log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 1800) : ''}`);
};

// ---------- unita' ----------
ok(trigramDice('telefono', 'telefon') > 0.6 && trigramDice('telefono', 'ragione sociale') < 0.1, 'trigrammi: varianti vicine alte, etichette diverse basse');
ok(trigramDice('celulare', 'cellulare') > 0.7 && similarity('celulare', 'Cellulare') > 0.4 && similarity('celulare', 'Cellulare') <= 0.5, 'trigrammi: refuso "celulare" ~ "Cellulare" sale ma resta prudente (<= 0,5)', similarity('celulare', 'Cellulare'));
let t0 = performance.now();
for (let k = 0; k < 2000; k++) trigramDice('numero di telefono ' + k, 'N. Telef. ' + (k % 7));
ok((performance.now() - t0) / 2000 < 0.5, 'trigrammi: meno di 0,5 ms a confronto', ((performance.now() - t0) / 2000).toFixed(4) + ' ms');
ok(capTokens('x'.repeat(100000)).endsWith('--- TRUNCATED ---') && capTokens('abc') === 'abc', 'script: risultato oltre 6.000 token troncato');

const fake = async (n, a) => (n === 'read' ? 'a\tb\n1\t2\n3\t4' : `${n}:${JSON.stringify(a)}`);
const run = (code, o = {}) => runScript(code, { call: fake, rows: ['x1', 'y', 'x2'], ...o });
let s = await run('return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof globalThis.process].join()');
ok(s.ok && s.out === 'undefined,undefined,undefined,undefined,undefined', 'sandbox: niente process, require, fetch, timer', s.out);
for (const [name, code] of [
  ['this.constructor.constructor', 'return this.constructor.constructor("return process")()'],
  ['colibri.open.constructor', 'return colibri.open.constructor("return process")()'],
  ['errore dell\'host', 'try { await colibri.nope() } catch (e) { return e.constructor.constructor("return process")() }'],
  ['promessa di una chiamata', 'return colibri.view().constructor.constructor("return process")()'],
  ['Promise.prototype.then', 'Promise.prototype.then = function (a) { return a.constructor.constructor("return process")().pid }; return 1'],
  ['eval', 'return eval("1+1")'],
]) {
  s = await run(code);
  ok(!/^\d{2,}$/.test(s.out) && !/\[object process\]/.test(s.out) && (!s.ok || s.out === '1'), `sandbox: nessuna fuga con ${name}`, JSON.stringify(s));
}
s = await run('return (await import("node:fs")).readFileSync("/etc/hostname", "utf8")');
ok(!s.ok, 'sandbox: import() non disponibile', s.out);
t0 = Date.now();
s = await run('while (true) {}', { timeoutMs: 1500 });
ok(!s.ok && /interrotto/.test(s.out) && Date.now() - t0 < 4000, 'sandbox: ciclo infinito interrotto dal timeout', s.out);
s = await run('await colibri.view(); while (true) {}', { timeoutMs: 1500 });
ok(!s.ok && /interrotto/.test(s.out), 'sandbox: ciclo infinito dopo un await interrotto', s.out);
s = await run('for (let i = 0; i < 100; i++) await colibri.view()', { maxCalls: 10 });
ok(!s.ok && /10 chiamate/.test(s.out), 'sandbox: limite di chiamate', s.out);
s = await run('return colibri.rows.filter((r) => r.startsWith("x"))');
ok(s.ok && s.out === '["x1","x2"]', 'script: colibri.rows filtrabili', s.out);

// ---------- end-to-end, modalita' standard ----------
const c = await connect({ CB_PROFILE_DIR: path.join(root, 'prof'), CB_HUMAN_WAIT: '0' });
const tools = (await c.client.listTools()).tools;
const doTool = tools.find((x) => x.name === 'browse_do');
ok(tools.length === 8 && doTool && doTool.inputSchema.properties.script, 'standard: 8 tool, browse_do ha "script"', tools.map((x) => x.name).join());

let r = (await c.call('browse_open', { url: base + '/notizie.html' })).text;
ok(/@"Nuovo bando digitale per le PMI": e\d+ link "Leggi tutto"/.test(r) && /@"Webinar sulla formazione finanziata": e\d+ link "Leggi tutto"/.test(r), 'link generici ripetuti: titolo della card come contesto', r);
r = await c.call('browse_do', { steps: [{ click: { name: 'Leggi tutto', row: 'Webinar' } }] });
ok(!r.isError && /^ok 1\/1/.test(r.text), 'link generico: clic con {name, row:"titolo card"}', r.text);

r = (await c.call('browse_read', { mode: 'table', filter: 'excel' })).text;
ok(/Codice\tTitolo\tImporto/.test(r) && /Corso Excel\t1200/.test(r) && /Corso Excel avanzato/.test(r) && !/Python/.test(r), 'read table filter: solo righe pertinenti, intestazione tenuta', r);
r = (await c.call('browse_read', { mode: 'text', match: 'bando|webinar' })).text;
ok(/scade il 31 dicembre/.test(r) && /webinar si terra/.test(r) && !/segreteria/.test(r), 'read text match (alias di filter): solo righe pertinenti', r);
r = (await c.call('browse_view', { match: 'successiva' })).text;
ok(/Pagina successiva/.test(r) && !/Leggi tutto/.test(r) && /notizie\.html/.test(r), 'view match: filtro con intestazione di pagina', r);

r = await c.call('browse_do', {
  steps: [],
  script: 'const t = await colibri.tables(); const corsi = t.slice(1).filter((x) => /corso/i.test(x[1])); return { n: corsi.length, totale: corsi.reduce((s, x) => s + Number(x[2]), 0) };',
});
ok(!r.isError && r.text.startsWith('{"n":3,"totale":5100}'), 'script: filtra e somma i dati di pagina in un turno', r.text);
r = await c.call('browse_do', { steps: [{ scroll: 'bottom' }], script: 'return colibri.rows.filter((x) => /Leggi tutto/.test(x)).length' });
ok(!r.isError && /^ok 1\/1/.test(r.text) && /\n3(\n|$)/.test(r.text) && !/Pagina successiva/.test(r.text), 'script dopo i passi: esito dei passi + solo il risultato', r.text);
r = await c.call('browse_do', { steps: [], script: 'return typeof process + "," + typeof fetch' });
ok(r.text.startsWith('undefined,undefined'), 'script e2e: process e fetch assenti', r.text);
r = await c.call('browse_do', { steps: [], script: 'let n = 0; while (n < 3) { await colibri.view({ filter: "notizie" }); n++; } return "pagine " + n;' });
ok(/^pagine 3/.test(r.text) && /3 chiamate/.test(r.text), 'script: ciclo condizionale con chiamate a Colibri', r.text);

// !x e !c dentro lo script
await c.call('browse_open', { url: base + '/pagato.html' });
r = await c.call('browse_do', { steps: [], script: 'return await colibri.do([{ fill: "Numero carta", text: "4111111111111111", confirm: true }])' });
ok(/BLOCCATO !x/.test(r.text), 'script: !x non compilabile neanche con confirm nello script', r.text);
r = await c.call('browse_do', { steps: [], script: 'return await colibri.do({ steps: [{ click: "Paga ora", confirm: true }] })' });
ok(/BLOCCATO !c/.test(r.text), 'script: !c bloccato, il confirm scritto dallo script non vale', r.text);
r = await c.call('browse_do', { steps: [], script: 'return await colibri.task({ params: {}, submit: "Paga ora", confirm: true })' });
ok(!/ORDINE INVIATO/.test((await c.call('browse_read', { mode: 'find', query: 'ORDINE' })).text), 'script: task con confirm dallo script non invia', r.text);
r = await c.call('browse_do', { steps: [], confirm: true, script: 'await colibri.do([{ click: "Paga ora", confirm: true }]); return await colibri.read({ mode: "find", query: "ORDINE" })' });
ok(/ORDINE INVIATO/.test(r.text), 'script: !c eseguito solo con confirm:true sulla chiamata MCP (dopo l\'ok dell\'utente)', r.text);

// ---------- browse_task: sezioni, Shadow DOM, trigrammi ----------
r = (await c.call('browse_task', { url: base + '/sedi.html', params: { 'indirizzo sede operativa': 'Via Napoli 5', 'via sede amministrativa': 'Via Milano 3', 'N. telefono': '0815551234', 'P.IVA': '01234567890' } })).text;
ok(/"indirizzo sede operativa" → e\d+ "Indirizzo"/.test(r) && /"via sede amministrativa" → e\d+ "Via"/.test(r) && /4\/4 impostati/.test(r), 'task: campi omonimi distinti dalla sezione (anche nello Shadow DOM)', r);
r = (await c.call('browse_task', { url: base + '/sedi.html', params: { indirizzo: 'Via X 1' } })).text;
ok(/da chiarire/.test(r) && /\[Sede legale\]/.test(r) && /\[Sede operativa/.test(r), 'task: campo ambiguo -> candidati con la sezione, nessuna scelta', r);

// ---------- attesa adattiva: risposta di rete + aggiornamento del DOM subito dopo ----------
await c.call('browse_open', { url: base + '/dinamico.html' });
t0 = Date.now();
r = (await c.call('browse_do', { steps: [{ select: 'Tipo richiesta', option: 'Contributo' }, { click: 'Continua' }] })).text;
ok(/Importo richiesto/.test(r) && /Codice pratica/.test(r), 'SPA: i campi arrivati dopo la risposta compaiono nel diff senza wait', r);
ok(Date.now() - t0 < 3000, 'SPA: nessuna attesa lunga', Date.now() - t0 + ' ms');
await c.close();

// ---------- CB_CODE_MODE=1 ----------
const k = await connect({ CB_PROFILE_DIR: path.join(root, 'prof-code'), CB_HUMAN_WAIT: '0', CB_CODE_MODE: '1' });
const ct = (await k.client.listTools()).tools;
ok(ct.length === 1 && ct[0].name === 'browse_code' && /colibri\.open/.test(ct[0].description), 'code mode: un solo tool con le firme compatte', ct.map((x) => x.name).join());
ok(/!c/.test(k.client.getInstructions()) && /!x/.test(k.client.getInstructions()) && /untrusted/.test(k.client.getInstructions()), 'code mode: istruzioni di sicurezza presenti');
r = await k.call('browse_code', { code: `await colibri.open({ url: ${JSON.stringify(base + '/notizie.html')}, rows: false }); const t = await colibri.tables({ filter: 'corso' }); return t.length;` });
ok(!r.isError && /^4/.test(r.text), 'code mode: apre e legge una tabella filtrata in una chiamata', r.text);
r = await k.call('browse_code', { code: `await colibri.open({ url: ${JSON.stringify(base + '/pagato.html')} }); return await colibri.do([{ click: 'Paga ora', confirm: true }]);` });
ok(/BLOCCATO !c/.test(r.text), 'code mode: !c bloccato senza confirm sulla chiamata', r.text);
await k.close();

srv.close();
console.log(log.join('\n') + `\n\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
