// Code mode locale: uno script JS dell'agente gira in una sandbox node:vm dentro un worker_thread,
// chiama gli stessi handler di Colibri (stessi controlli di sicurezza) e restituisce solo il risultato finale.
//
// Isolamento (node:vm da solo NON e' un confine di sicurezza, quindi si sommano piu' barriere):
//  - worker separato con memoria limitata: un ciclo infinito o una promessa appesa si chiudono con terminate();
//  - contesto con prototipo nullo e codeGeneration { strings: false, wasm: false }: niente eval/Function;
//  - nessun oggetto dell'host entra nel contesto: l'API `colibri` e' costruita DENTRO il contesto e parla con
//    l'host solo con stringhe (JSON); le due funzioni ponte restano in una chiusura che lo script non vede;
//  - niente process, require, import, fetch, fs, child_process, timer: non esistono nel contesto.
import { Worker } from 'node:worker_threads';
import { estTokens } from './lib/render.js';

export const SCRIPT_MAX_TOK = 6000;
export const SCRIPT_MAX_MS = 60000;
export const SCRIPT_MAX_CALLS = 60;
export const SCRIPT_API = ['open', 'search', 'view', 'read', 'do', 'task', 'stats'];

// codice del worker (CommonJS, eseguito con eval: true)
const WORKER = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const ctx = vm.createContext(Object.create(null), { name: 'colibri-script', codeGeneration: { strings: false, wasm: false } });
// costruita nel contesto: usa solo intrinseci del contesto, catturati prima che lo script possa modificarli
const SETUP = '(function (post, done, api, data) {' +
  '"use strict";' +
  'const stringify = JSON.stringify, parse = JSON.parse, then = Promise.prototype.then, apply = Reflect.apply, freeze = Object.freeze, S = String;' +
  'const pend = new Map(), get = Map.prototype.get, del = Map.prototype.delete, set = Map.prototype.set; let seq = 0;' +
  'const call = (name, args) => new Promise((res, rej) => { const id = ++seq; apply(set, pend, [id, [res, rej]]); post(id, name, stringify(args === undefined ? {} : args) || "{}"); });' +
  'const settle = (id, ok, json) => { const p = apply(get, pend, [id]); if (!p) return; apply(del, pend, [id]); if (ok) p[0](parse(json)); else p[1](new Error(json)); };' +
  'const d = parse(data);' +
  'const c = { rows: freeze(d.rows) };' +
  'for (const n of parse(api)) c[n] = (a) => call(n, a);' +
  'c.text = (a) => call("read", Object.assign({ mode: "text" }, a));' +
  'c.tables = (a) => apply(then, call("read", Object.assign({ mode: "table" }, a)), [(t) => S(t).split("\\n").filter((l) => l.includes("\\t")).map((l) => l.split("\\t"))]);' +
  'Object.defineProperty(globalThis, "colibri", { value: freeze(c) });' +
  'const out = (v) => (typeof v === "string" ? v : v === undefined ? "" : (stringify(v) ?? S(v)));' +
  'const run = (fn) => { let p; try { p = fn(); } catch (e) { return done(false, S(e && e.message ? e.message : e)); }' +
  '  apply(then, Promise.resolve(p), [(v) => { let s; try { s = out(v); } catch (e) { return done(false, "risultato non serializzabile: " + S(e && e.message)); } done(true, s); }, (e) => done(false, S(e && e.message ? e.message : e))]); };' +
  'return { settle, run };' +
'})';
const bridge = vm.runInContext(SETUP, ctx, { timeout: 1000 })(
  (id, name, json) => parentPort.postMessage({ t: 'call', id, name: String(name), json: String(json) }),
  (ok, out) => parentPort.postMessage({ t: 'done', ok: !!ok, out: String(out) }),
  JSON.stringify(workerData.api),
  JSON.stringify({ rows: workerData.rows })
);
parentPort.on('message', (m) => {
  try { bridge.settle(m.id, m.ok, m.json); } catch (e) { parentPort.postMessage({ t: 'done', ok: false, out: String(e && e.message) }); }
});
let fn;
try {
  fn = new vm.Script('(async function () {\n' + workerData.code + '\n})', { filename: 'script.js' }).runInContext(ctx, { timeout: 1000 });
} catch (e) {
  parentPort.postMessage({ t: 'done', ok: false, out: 'sintassi: ' + String(e && e.message) });
}
if (fn) {
  try { bridge.run(fn); } catch (e) { parentPort.postMessage({ t: 'done', ok: false, out: String(e && e.message) }); }
}
`;

/** Tronca un risultato oltre il budget di token. */
export function capTokens(s, max = SCRIPT_MAX_TOK) {
  if (estTokens(s) <= max) return s;
  return s.slice(0, Math.floor(max * 3.6)) + '\n--- TRUNCATED ---';
}

/**
 * Esegue `code` (corpo di una funzione async) con l'oggetto `colibri`.
 * call(name, args) -> Promise<string|object>: l'host esegue la chiamata con i controlli di Colibri.
 * Restituisce { ok, out, calls }.
 */
export function runScript(code, { call, rows = [], timeoutMs = SCRIPT_MAX_MS, maxCalls = SCRIPT_MAX_CALLS } = {}) {
  return new Promise((resolve) => {
    let calls = 0;
    let finished = false;
    const w = new Worker(WORKER, {
      eval: true,
      workerData: { code: String(code), api: SCRIPT_API, rows: rows.map(String) },
      env: {},
      argv: [],
      execArgv: [],
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const end = (ok, out) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      w.terminate().catch(() => {});
      resolve({ ok, out: capTokens(String(out)), calls });
    };
    const timer = setTimeout(() => end(false, `script oltre ${Math.round(timeoutMs / 1000)} s: interrotto`), timeoutMs);
    w.on('message', async (m) => {
      if (finished || !m) return;
      if (m.t === 'done') return end(m.ok, m.out);
      if (m.t !== 'call') return;
      let reply;
      try {
        if (++calls > maxCalls) throw new Error(`oltre ${maxCalls} chiamate nello script`);
        if (!SCRIPT_API.includes(m.name)) throw new Error(`colibri.${m.name} non esiste`);
        const r = await call(m.name, JSON.parse(m.json));
        reply = { id: m.id, ok: true, json: JSON.stringify(r === undefined ? null : r) };
      } catch (e) {
        reply = { id: m.id, ok: false, json: String((e && e.message) || e).split('\n')[0].slice(0, 300) };
      }
      if (!finished) w.postMessage(reply);
    });
    w.on('error', (e) => end(false, String((e && e.message) || e).split('\n')[0]));
    w.on('exit', () => end(false, 'script terminato senza risultato'));
  });
}

/** Rende le chiamate dello script innocue rispetto alle conferme: il flag `confirm` vale solo se arriva dalla chiamata MCP. */
export function stripConfirm(name, a, outerConfirm) {
  const args = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
  const clean = (steps) =>
    Array.isArray(steps)
      ? steps.map((s) => {
          if (!s || typeof s !== 'object') return s;
          const o = { ...s };
          if (!outerConfirm) delete o.confirm;
          return o;
        })
      : steps;
  if (name === 'do') {
    args.steps = clean(args.steps);
    delete args.script;
  }
  if (name === 'task') {
    if (!outerConfirm) delete args.confirm;
    args.before = clean(args.before);
  }
  return args;
}
