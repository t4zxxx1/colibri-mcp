// Benchmark: stessi compiti eseguiti con tre metodi, misurando chiamate, token e tempi reali.
//  M1 screenshot: un'azione per chiamata, uno screenshot dopo ogni azione (stile computer use / Claude in Chrome a screenshot)
//  M2 albero di accessibilita': Playwright MCP 0.0.83 reale (snapshot YAML + fill_form)
//  M3 browser compatto: questo server MCP
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serve } from './server.mjs';
import { connect, TEST_ENV, TMP } from './mcp-client.mjs';
import { createRequire } from 'node:module';
import { m4, m5, m6, agentBrowserSkillStub } from './bench-rivals.mjs';

const SCR = TMP;
fs.mkdirSync(SCR, { recursive: true });
const require = createRequire(import.meta.url);
const { countTokens } = require('@anthropic-ai/tokenizer');
const PW_MCP_CLI = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
const ARGS = TEST_ENV.CB_EXTRA_ARGS.split(' ').filter(Boolean);
// stesso browser per tutti e tre i metodi: TEST_CHROME se indicato, altrimenti Chrome installato
const BROWSER = process.env.TEST_CHROME ? { executablePath: process.env.TEST_CHROME } : { channel: 'chrome' };
const PW_BROWSER = process.env.TEST_CHROME ? ['--executable-path', process.env.TEST_CHROME] : ['--browser', 'chrome'];
const VW = 1280;
const VH = 800;
const SHOT_TOK = Math.ceil((VW * VH) / 750);

const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;

// ---------------- M3: browser compatto ----------------
async function m3(task) {
  fs.rmSync(SCR + '/prof-bench', { recursive: true, force: true });
  const c = await connect({ CB_PROFILE_DIR: SCR + '/prof-bench' });
  const tools = (await c.client.listTools()).tools;
  const out = [];
  const call = async (name, args) => {
    const r = await c.call(name, args);
    out.push({ name, args, text: r.text, ms: r.ms, img: 0 });
    return r.text;
  };
  let okTask = false;
  if (task === 'T1') {
    await call('browse_open', { url: base + '/domanda1.html' });
    await call('browse_do', {
      steps: [
        { fill: 'Ragione sociale', text: 'Alfa Meccanica S.r.l.' },
        { fill: 'Partita IVA', text: '01234567890' },
        { fill: 'Codice fiscale azienda', text: '01234567890' },
        { select: 'Codice ATECO', option: '62' },
        { select: 'Regione', option: 'Campania' },
        { select: 'Provincia', option: 'Napoli' },
        { type: 'Comune', text: 'Isch' },
        { pick: 'Ischia' },
        { fill: 'Indirizzo sede legale', text: 'Via Roma 1' },
        { fill: 'CAP', text: '80077' },
        { fill: 'PEC', text: 'alfa@pec.it' },
        { fill: 'Nome', text: 'Mario' },
        { fill: 'Cognome', text: 'Rossi' },
        { fill: 'Email', text: 'mario@alfa.it' },
        { check: 'Legale rappresentante' },
        { fill: 'Titolo del piano', text: 'Competenze digitali 2026' },
        { select: 'Fonte di finanziamento', option: 'Fondo Nuove Competenze' },
        { fill: 'Numero dipendenti coinvolti', text: '12' },
        { fill: 'Ore di formazione', text: '40' },
        { fill: 'Data inizio', text: '2026-11-03' },
        { fill: 'Data fine', text: '15/12/2026' },
        { fill: 'Descrizione degli obiettivi', text: 'Sviluppare competenze digitali di base per 12 dipendenti.' },
      ],
    });
    // [conferma utente per le dichiarazioni]
    await call('browse_do', { steps: [{ check: 'Dichiaro di aver letto', confirm: true }, { check: 'Dichiaro che i dati', confirm: true }, { click: 'Avanti' }, { read: 'table' }] });
    // [conferma utente per l'invio]
    const t = await call('browse_do', { steps: [{ click: 'Invia domanda', confirm: true }, { click: 'Conferma invio', confirm: true }] });
    okTask = /Protocollo n\. 2026\/004512/.test(t);
  } else if (task === 'T2') {
    await call('browse_open', { url: base + '/elenco.html' });
    const t = await call('browse_do', { steps: [{ click: { name: 'Visualizza', row: 'PF-2026-115' } }, { read: 'table' }] });
    okTask = /Ed\. 6/.test(t) && t.includes('PF-2026-115');
  } else if (task === 'T3') {
    await call('browse_open', { url: base + '/index.html' });
    const t = await call('browse_do', { steps: [{ click: 'Elenco progetti' }, { find: 'progetti trovati' }], view: 'none' });
    okTask = /25 progetti trovati/.test(t);
  }
  await c.close();
  return { calls: out, tools, ok: okTask };
}

// ---------------- M2: Playwright MCP ----------------
async function m2(task) {
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [PW_MCP_CLI, '--headless', '--isolated', '--no-sandbox', ...PW_BROWSER, '--viewport-size', `${VW}x${VH}`],
    stderr: 'pipe',
    cwd: SCR,
  });
  const c = new Client({ name: 'bench', version: '1' });
  await c.connect(t);
  const tools = (await c.listTools()).tools;
  const out = [];
  const call = async (name, args) => {
    const t0 = performance.now();
    const r = await c.callTool({ name, arguments: args });
    const ms = performance.now() - t0;
    const text = r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    out.push({ name, args, text, ms, img: 0, isError: r.isError });
    if (r.isError) throw new Error(name + ': ' + text.slice(0, 300));
    return text;
  };
  const ref = (snap, role, name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = snap.match(new RegExp(`- ${role} "${esc}[^"\\n]*"[^\\n]*\\[ref=((?:f\\d+)?e\\d+)\\]`));
    if (!m) {
      fs.writeFileSync(SCR + '/m2-debug.txt', out.map((c) => `### ${c.name} ${JSON.stringify(c.args).slice(0, 300)}\n${c.text}`).join('\n\n'));
      throw new Error(`ref non trovato: ${role} "${name}"`);
    }
    return m[1];
  };
  let okTask = false;
  if (task === 'T1') {
    await call('browser_navigate', { url: base + '/domanda1.html' });
    let s = await call('browser_snapshot', {});
    await call('browser_click', { element: 'Rifiuta cookie', target: ref(s, 'button', 'Rifiuta') });
    const F = (name, type, role, value) => ({ name, type, target: ref(s, role, name), value });
    await call('browser_fill_form', {
      fields: [
        F('Ragione sociale', 'textbox', 'textbox', 'Alfa Meccanica S.r.l.'),
        F('Partita IVA', 'textbox', 'textbox', '01234567890'),
        F('Codice fiscale azienda', 'textbox', 'textbox', '01234567890'),
        F('Codice ATECO', 'combobox', 'combobox', '62 - Industrie alimentari (62)'),
        F('Regione', 'combobox', 'combobox', 'Campania'),
        F('Provincia', 'combobox', 'combobox', 'Napoli'),
        F('Indirizzo sede legale', 'textbox', 'textbox', 'Via Roma 1'),
        F('CAP', 'textbox', 'textbox', '80077'),
        F('PEC', 'textbox', 'textbox', 'alfa@pec.it'),
        F('Nome', 'textbox', 'textbox', 'Mario'),
        F('Cognome', 'textbox', 'textbox', 'Rossi'),
        F('Email', 'textbox', 'textbox', 'mario@alfa.it'),
        F('Legale rappresentante', 'radio', 'radio', 'true'),
        F('Titolo del piano', 'textbox', 'textbox', 'Competenze digitali 2026'),
        F('Fonte di finanziamento', 'combobox', 'combobox', 'Fondo Nuove Competenze'),
        F('Numero dipendenti coinvolti', 'textbox', 'spinbutton', '12'),
        F('Ore di formazione', 'textbox', 'spinbutton', '40'),
        F('Data inizio', 'textbox', 'textbox', '2026-11-03'),
        F('Data fine', 'textbox', 'textbox', '15/12/2026'),
        F('Descrizione degli obiettivi', 'textbox', 'textbox', 'Sviluppare competenze digitali di base per 12 dipendenti.'),
      ],
    });
    await call('browser_type', { element: 'Comune', target: ref(s, 'combobox', 'Comune'), text: 'Isch', slowly: true });
    s = await call('browser_snapshot', {});
    await call('browser_click', { element: 'Ischia', target: ref(s, 'option', 'Ischia') });
    // [conferma utente per le dichiarazioni]
    await call('browser_fill_form', {
      fields: [
        { name: 'Privacy', type: 'checkbox', target: ref(s, 'checkbox', "Dichiaro di aver letto"), value: 'true' },
        { name: 'Veridicita', type: 'checkbox', target: ref(s, 'checkbox', 'Dichiaro che i dati'), value: 'true' },
      ],
    });
    await call('browser_click', { element: 'Avanti', target: ref(s, 'button', 'Avanti') });
    s = await call('browser_snapshot', {});
    // [conferma utente per l'invio]
    await call('browser_click', { element: 'Invia domanda', target: ref(s, 'button', 'Invia domanda') });
    s = await call('browser_snapshot', {});
    await call('browser_click', { element: 'Conferma invio', target: ref(s, 'button', 'Conferma invio') });
    s = await call('browser_snapshot', {});
    okTask = /Protocollo n\. 2026\/004512/.test(s) && /Ischia/.test(out[out.length - 5].text);
  } else if (task === 'T2') {
    await call('browser_navigate', { url: base + '/elenco.html' });
    let s = await call('browser_snapshot', {});
    const m = s.match(/cell "PF-2026-115"[^\n]*\n(?:\s+-[^\n]*\n)*?\s+- link "Visualizza" \[ref=((?:f\d+)?e\d+)\]/);
    if (!m) throw new Error('riga PF-2026-115 non trovata');
    await call('browser_click', { element: 'Visualizza PF-2026-115', target: m[1] });
    s = await call('browser_snapshot', {});
    okTask = /Ed\. 6/.test(s) && /PF-2026-115/.test(s);
  } else if (task === 'T3') {
    await call('browser_navigate', { url: base + '/index.html' });
    let s = await call('browser_snapshot', {});
    await call('browser_click', { element: 'Elenco progetti', target: ref(s, 'link', 'Elenco progetti') });
    s = await call('browser_snapshot', {});
    okTask = /25 progetti trovati/.test(s);
  }
  await c.close();
  return { calls: out, tools, ok: okTask };
}

// ---------------- M1: screenshot dopo ogni azione ----------------
async function m1(task) {
  const b = await chromium.launch({ ...BROWSER, headless: true, args: ARGS });
  const page = await b.newPage({ viewport: { width: VW, height: VH } });
  const out = [];
  const shot = async (args, fn, wait = 300) => {
    const t0 = performance.now();
    await fn();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(wait);
    const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
    out.push({ name: 'computer', args, text: '', ms: performance.now() - t0, img: SHOT_TOK, bytes: buf.length });
  };
  const visible = async (loc) => {
    for (let k = 0; k < 12; k++) {
      const bb = await loc.boundingBox();
      if (bb && bb.y >= 0 && bb.y + bb.height <= VH) return bb;
      const dir = bb && bb.y < 0 ? -1 : 1;
      await shot({ action: 'scroll', coordinate: [640, 400], scroll_direction: dir > 0 ? 'down' : 'up', scroll_amount: 5 }, () => page.mouse.wheel(0, dir * 500));
    }
    throw new Error('elemento non raggiungibile');
  };
  const click = async (loc, wait) => {
    const bb = await visible(loc);
    const x = Math.round(bb.x + bb.width / 2);
    const y = Math.round(bb.y + bb.height / 2);
    await shot({ action: 'left_click', coordinate: [x, y] }, () => page.mouse.click(x, y), wait);
  };
  const type = (text, wait) => shot({ action: 'type', text }, () => page.keyboard.type(text), wait);
  const field = async (label, text) => {
    await click(page.getByLabel(label, { exact: false }).first());
    await type(text);
  };
  const sel = async (label, text) => {
    await click(page.getByLabel(label, { exact: false }).first());
    await shot({ action: 'type', text: text + '\n' }, async () => {
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
    });
  };
  let okTask = false;
  if (task === 'T1') {
    await shot({ action: 'navigate', url: base + '/domanda1.html' }, () => page.goto(base + '/domanda1.html'));
    await click(page.getByRole('button', { name: 'Rifiuta' }));
    await field('Ragione sociale', 'Alfa Meccanica S.r.l.');
    await field('Partita IVA', '01234567890');
    await field('Codice fiscale azienda', '01234567890');
    await sel('Codice ATECO', '62');
    await sel('Regione', 'Campania');
    await sel('Provincia', 'Napoli');
    await click(page.locator('#com'));
    await type('Isch', 600);
    await click(page.getByRole('option', { name: 'Ischia', exact: true }));
    await field('Indirizzo sede legale', 'Via Roma 1');
    await field('CAP', '80077');
    await field('PEC', 'alfa@pec.it');
    await field('Nome *', 'Mario');
    await field('Cognome', 'Rossi');
    await field('Email', 'mario@alfa.it');
    await click(page.getByLabel('Legale rappresentante'));
    await field('Titolo del piano', 'Competenze digitali 2026');
    await sel('Fonte di finanziamento', 'Fondo Nuove Competenze');
    await field('Numero dipendenti', '12');
    await field('Ore di formazione', '40');
    await click(page.locator('#di'));
    await type('11032026');
    await field('Data fine', '15/12/2026');
    await field('Descrizione degli obiettivi', 'Sviluppare competenze digitali di base per 12 dipendenti.');
    // [conferma utente per le dichiarazioni]
    await click(page.locator('label[for=priv]'));
    await click(page.locator('label[for=dich]'));
    await click(page.getByRole('button', { name: 'Avanti' }), 700);
    // lettura del riepilogo: scorrere fino in fondo alla tabella
    await visible(page.locator('#riep tbody tr').last());
    // [conferma utente per l'invio]
    await click(page.getByRole('button', { name: 'Invia domanda' }));
    await click(page.getByRole('button', { name: 'Conferma invio' }));
    await visible(page.locator('#ok'));
    okTask = /Protocollo n\. 2026\/004512/.test(await page.locator('#ok').innerText()) && (await page.locator('#riep').innerText()).includes('Ischia');
  } else if (task === 'T2') {
    await shot({ action: 'navigate', url: base + '/elenco.html' }, () => page.goto(base + '/elenco.html'));
    await click(page.locator('tr', { hasText: 'PF-2026-115' }).getByRole('link', { name: 'Visualizza' }), 500);
    await visible(page.locator('#ed tbody tr').last());
    okTask = (await page.locator('#ed').innerText()).includes('Ed. 6') && page.url().includes('PF-2026-115');
  } else if (task === 'T3') {
    await shot({ action: 'navigate', url: base + '/index.html' }, () => page.goto(base + '/index.html'));
    await click(page.getByRole('link', { name: 'Elenco progetti' }), 500);
    okTask = (await page.locator('#cnt').innerText()).includes('25 progetti trovati');
  }
  await b.close();
  return { calls: out, tools: null, ok: okTask };
}

// ---------------- metriche ----------------
const BASE_CTX = 5000; // prompt di sistema + richiesta (ipotesi uguale per tutti)
const PER_CALL = 40; // token del blocco tool_use + breve ragionamento (ipotesi)
const FINAL = 150; // risposta finale
const TTFT = 1.5; // s per turno (ipotesi)
const TPS = 60; // token/s di generazione (ipotesi)
const tok = (s) => (s ? countTokens(s) : 0);
const f = (n) => Math.round(n).toLocaleString('it-IT');

function metrics(r, toolDefTok) {
  let ctx = BASE_CTX + toolDefTok;
  let inputTot = 0;
  let outTot = 0;
  let obs = 0;
  let toolMs = 0;
  let modelS = 0;
  let cacheCost = 0;
  let prevNew = BASE_CTX + toolDefTok;
  for (const c of r.calls) {
    const a = tok(JSON.stringify(c.args)) + PER_CALL;
    const o = c.img ? c.img + 10 : tok(c.text);
    inputTot += ctx;
    cacheCost += (ctx - prevNew) * 0.1e-6 + prevNew * 2.5e-6;
    outTot += a;
    modelS += TTFT + a / TPS;
    obs += o;
    toolMs += c.ms;
    prevNew = a + o;
    ctx += a + o;
  }
  inputTot += ctx; // turno finale
  cacheCost += (ctx - prevNew) * 0.1e-6 + prevNew * 2.5e-6 + FINAL * 10e-6;
  outTot += FINAL;
  modelS += TTFT + FINAL / TPS;
  const costNoCache = inputTot * 2e-6 + outTot * 10e-6;
  for (const c of r.calls) cacheCost += (tok(JSON.stringify(c.args)) + PER_CALL) * 10e-6;
  return { calls: r.calls.length, obs, maxObs: Math.max(...r.calls.map((c) => (c.img ? c.img : tok(c.text)))), ctxEnd: ctx, inputTot, outTot, toolS: toolMs / 1000, modelS, totS: toolMs / 1000 + modelS, costNoCache, cacheCost, ok: r.ok };
}

const NAMES = {
  M1: 'Screenshot',
  M2: 'Playwright MCP',
  M3: 'Browser compatto',
  M4: 'agent-browser CLI',
  M5: 'agent-browser MCP',
  M6: 'Fast Playwright MCP',
  M4b: 'agent-browser CLI senza guida',
};
const ONLY = (process.env.METHODS || 'M1,M2,M3,M4,M5,M6').split(',');
const results = {};
const defs = {
  M1: 1500, // ipotesi: definizione del tool computer/screenshot
  M4: 1500 + tok(agentBrowserSkillStub()), // ipotesi per il tool Bash + skill di agent-browser sempre presente
};
const raw = (r) => r.calls.map((c) => ({ n: c.name, t: c.img ? c.img : tok(c.text), ms: Math.round(c.ms) }));
for (const task of ['T1', 'T2', 'T3']) {
  results[task] = {};
  const runs = {
    M1: () => m1(task),
    M2: () => m2(task),
    M3: () => m3(task),
    M4: () => m4(task, base),
    M5: () => m5(task, base),
    M6: () => m6(task, base, { VW, VH }),
  };
  for (const m of ONLY) {
    const r = await runs[m]();
    if (r.tools) defs[m] = tok(JSON.stringify(r.tools));
    results[task][m] = { ...metrics(r, defs[m]), raw: raw(r) };
    // variante: agente che conosce gia' i comandi e non carica la guida "core" (9.600 token circa)
    if (m === 'M4') {
      const r2 = { ...r, calls: r.calls.slice(1) };
      defs.M4b = defs.M4;
      results[task].M4b = { ...metrics(r2, defs.M4b), raw: raw(r2) };
    }
  }
}
srv.close();
fs.writeFileSync(path.join(SCR, 'bench-results.json'), JSON.stringify({ names: NAMES, defs, results, SHOT_TOK, assumptions: { BASE_CTX, PER_CALL, FINAL, TTFT, TPS } }, null, 1));

console.log(`risultati completi: ${path.join(SCR, 'bench-results.json')}`);
console.log('definizioni tool/istruzioni sempre nel contesto (token): ' + Object.entries(defs).map(([m, v]) => `${NAMES[m]} ${f(v)}`).join(', ') + ` (screenshot e agent-browser CLI: ipotesi per il tool di sistema); screenshot ${VW}x${VH} = ${SHOT_TOK} token`);
for (const [task, R] of Object.entries(results)) {
  console.log(`\n${task}`);
  console.log('metodo                ok  chiamate  token osservazioni  max singola  contesto finale  input totale  output  tempo tool  tempo modello  totale   costo API (no cache / cache)');
  for (const [m, x] of Object.entries(R))
    console.log(`${NAMES[m].padEnd(20)}  ${x.ok ? 'si' : 'NO'}  ${String(x.calls).padStart(8)}  ${f(x.obs).padStart(17)}  ${f(x.maxObs).padStart(11)}  ${f(x.ctxEnd).padStart(15)}  ${f(x.inputTot).padStart(12)}  ${f(x.outTot).padStart(6)}  ${x.toolS.toFixed(1).padStart(9)}s  ${x.modelS.toFixed(1).padStart(12)}s  ${x.totS.toFixed(1).padStart(6)}s   $${x.costNoCache.toFixed(3)} / $${x.cacheCost.toFixed(3)}`);
}
