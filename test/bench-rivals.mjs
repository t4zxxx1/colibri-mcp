// Metodi concorrenti per il benchmark, usati nel modo piu' efficiente che la loro documentazione suggerisce.
//  M4 agent-browser da riga di comando (come in Claude Code): skill caricata, comandi in blocco, snapshot -i, --delta
//  M5 agent-browser via MCP, profilo "core" (come in Claude Desktop): un'azione per chiamata
//  M6 Fast Playwright MCP 0.2 (catalogo adattivo): batch_execute, snapshot solo quando serve
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);
const AB_JS = path.join(path.dirname(require.resolve('agent-browser/package.json')), 'bin', 'agent-browser.js');
const FPW_CLI = path.join(path.dirname(require.resolve('@tontoko/fast-playwright-mcp/package.json')), 'cli.js');

function chromePath() {
  if (process.env.TEST_CHROME) return process.env.TEST_CHROME;
  const cands = {
    linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  }[process.platform] || [];
  return cands.find((p) => fs.existsSync(p)) || '';
}
function run(cmd, args, env, input) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', () => resolve({ stdout, stderr }));
    if (input) p.stdin.write(input);
    p.stdin.end();
  });
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findRef = (snap, role, name) => {
  const m = snap.match(new RegExp(`- ${role} "\\s*${esc(name)}[^"\\n]*"[^\\n]*?ref=((?:f\\d+)?e\\d+)`));
  if (!m) throw new Error(`ref non trovato: ${role} "${name}"`);
  return m[1];
};

// ---------------- M4: agent-browser CLI ----------------
export async function m4(task, base) {
  const session = `bench-${task}-${Date.now()}`;
  const env = { ...process.env, AGENT_BROWSER_SESSION: session, AGENT_BROWSER_EXECUTABLE_PATH: chromePath(), AGENT_BROWSER_ARGS: '--no-sandbox' };
  const out = [];
  // una chiamata = un comando nella shell; args = testo che il modello scrive
  const sh = async (args, input) => {
    const t0 = performance.now();
    const r = await run(process.execPath, [AB_JS, ...args], env, input);
    const text = r.stdout + r.stderr;
    const cmd = 'agent-browser ' + args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ') + (input ? ` <<'EOF'\n${input}\nEOF` : '');
    out.push({ name: 'bash', args: { command: cmd }, text, ms: performance.now() - t0 });
    return text;
  };
  const batch = (cmds) => sh(['batch', '--bail'], JSON.stringify(cmds));
  // come farebbe un agente: se il blocco si ferma su un errore, ripete i passi rimasti dopo una breve attesa
  const batchRetry = async (cmds, tries = 2) => {
    let text = await batch(cmds);
    let all = text;
    for (let k = 0; k < tries && /^✗/m.test(text); k++) {
      const done = (text.match(/^✓/gm) || []).length;
      cmds = [['wait', '1000'], ...cmds.slice(done)];
      text = await batch(cmds);
      all += '\n' + text;
    }
    return all;
  };
  let okTask = false;
  // la skill installata chiede di caricare la guida "core" prima di qualsiasi comando
  await sh(['skills', 'get', 'core']);
  if (task === 'T1') {
    let s = await batch([['open', base + '/domanda1.html'], ['snapshot', '-i', '--delta']]);
    const R = (role, name) => '@' + findRef(s, role, name);
    await batchRetry([
      ['click', R('button', 'Rifiuta')],
      ['fill', R('textbox', 'Ragione sociale'), 'Alfa Meccanica S.r.l.'],
      ['fill', R('textbox', 'Partita IVA'), '01234567890'],
      ['fill', R('textbox', 'Codice fiscale azienda'), '01234567890'],
      ['select', R('combobox', 'Codice ATECO'), '62'],
      ['select', R('combobox', 'Regione'), 'Campania'],
      ['select', R('combobox', 'Provincia'), 'Napoli'],
      ['type', R('combobox', 'Comune'), 'Isch'],
      ['wait', '--text', 'Ischia'],
      ['find', 'role', 'option', 'click', '--name', 'Ischia', '--exact'],
      ['fill', R('textbox', 'Indirizzo sede legale'), 'Via Roma 1'],
      ['fill', R('textbox', 'CAP'), '80077'],
      ['fill', R('textbox', 'PEC'), 'alfa@pec.it'],
      ['fill', R('textbox', 'Nome'), 'Mario'],
      ['fill', R('textbox', 'Cognome'), 'Rossi'],
      ['fill', R('textbox', 'Email'), 'mario@alfa.it'],
      ['check', R('radio', 'Legale rappresentante')],
      ['fill', R('textbox', 'Titolo del piano'), 'Competenze digitali 2026'],
      ['select', R('combobox', 'Fonte di finanziamento'), 'Fondo Nuove Competenze'],
      ['fill', R('spinbutton', 'Numero dipendenti coinvolti'), '12'],
      ['fill', R('spinbutton', 'Ore di formazione'), '40'],
      // fill su <input type=date> risponde "Done" ma lascia il campo vuoto: l'agente (informato) usa eval
      ['eval', "const d=document.querySelector('input[type=date]');d.value='2026-11-03';d.dispatchEvent(new Event('change',{bubbles:true}))"],
      ['fill', R('textbox', 'Data fine'), '15/12/2026'],
      ['fill', R('textbox', 'Descrizione degli obiettivi'), 'Sviluppare competenze digitali di base per 12 dipendenti.'],
      ['snapshot', '-i', '--delta'],
    ]);
    // [conferma utente per le dichiarazioni]
    const r3 = await batchRetry([
      ['check', R('checkbox', 'Dichiaro di aver letto')],
      ['check', R('checkbox', 'Dichiaro che i dati')],
      ['click', R('button', 'Avanti')],
      ['wait', '--url', '**/domanda2.html'],
      ['get', 'text', 'main'],
    ]);
    // [conferma utente per l'invio]
    const r4 = await batchRetry([
      ['find', 'role', 'button', 'click', '--name', 'Invia domanda'],
      ['find', 'role', 'button', 'click', '--name', 'Conferma invio'],
      ['wait', '--text', 'Protocollo'],
      ['find', 'text', 'Protocollo', 'text'],
    ]);
    okTask = /Riepilogo e invio/.test(r3) && /comune\s+Ischia/.test(r3) && /Protocollo n\. 2026\/004512/.test(r4);
  } else if (task === 'T2') {
    const s = await batch([['open', base + '/elenco.html'], ['snapshot', '-i', '-u']]);
    const m = s.match(/- link "Visualizza" \[[^\]]*?ref=(e\d+)[^\]]*url=[^\]\n]*PF-2026-115[^\n]*|- link "Visualizza" \[ref=(e\d+)\][^\n]*\n\s+- \/url: [^\n]*PF-2026-115/);
    const ref = m && (m[1] || m[2]);
    if (!ref) throw new Error('agent-browser T2: riga PF-2026-115 non trovata nello snapshot\n' + s.slice(0, 2000));
    const t = await batch([['click', '@' + ref], ['wait', '--text', 'Edizioni'], ['get', 'text', 'main']]);
    okTask = /Ed\. 6/.test(t) && /PF-2026-115/.test(t);
  } else if (task === 'T3') {
    const s = await batch([['open', base + '/index.html'], ['snapshot', '-i']]);
    const t = await batch([['click', '@' + findRef(s, 'link', 'Elenco progetti')], ['wait', '--text', 'progetti trovati'], ['find', 'text', 'progetti trovati', 'text']]);
    okTask = /25 progetti trovati/.test(t);
  }
  await run(process.execPath, [AB_JS, 'close'], env);
  return { calls: out, tools: null, ok: okTask };
}

// ---------------- M5: agent-browser MCP (profilo core) ----------------
export async function m5(task, base) {
  const session = `benchmcp-${task}-${Date.now()}`;
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [AB_JS, 'mcp'],
    env: { ...process.env, AGENT_BROWSER_SESSION: session, AGENT_BROWSER_EXECUTABLE_PATH: chromePath(), AGENT_BROWSER_ARGS: '--no-sandbox' },
    stderr: 'pipe',
  });
  const c = new Client({ name: 'bench', version: '1' });
  await c.connect(t);
  const tools = [];
  let cursor;
  do {
    const r = await c.listTools(cursor ? { cursor } : {});
    tools.push(...r.tools);
    cursor = r.nextCursor;
  } while (cursor);
  const out = [];
  const call = async (name, args) => {
    const t0 = performance.now();
    const r = await c.callTool({ name: 'agent_browser_' + name, arguments: args });
    const text = r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    out.push({ name, args, text, ms: performance.now() - t0 });
    if (r.isError) throw new Error(`agent-browser MCP ${name}: ${text.slice(0, 300)}`);
    return text;
  };
  // come farebbe un agente: se un'azione fallisce, attende un attimo e ripete
  const callRetry = async (name, args) => {
    try {
      return await call(name, args);
    } catch {
      await call('wait_ms', { ms: 1000 });
      return call(name, args);
    }
  };
  let okTask = false;
  if (task === 'T1') {
    await call('open', { url: base + '/domanda1.html' });
    let s = await call('snapshot', { interactive: true });
    const R = (role, name) => '@' + findRef(s, role, name);
    await call('click', { selector: R('button', 'Rifiuta') });
    const fills = [
      ['textbox', 'Ragione sociale', 'Alfa Meccanica S.r.l.'], ['textbox', 'Partita IVA', '01234567890'], ['textbox', 'Codice fiscale azienda', '01234567890'],
    ];
    for (const [r, n, v] of fills) await call('fill', { selector: R(r, n), text: v });
    await call('select', { selector: R('combobox', 'Codice ATECO'), values: ['62'] });
    await call('select', { selector: R('combobox', 'Regione'), values: ['Campania'] });
    await callRetry('select', { selector: R('combobox', 'Provincia'), values: ['Napoli'] });
    await call('type', { selector: R('combobox', 'Comune'), text: 'Isch' });
    await call('wait_for_text', { text: 'Ischia' });
    const s2 = await call('snapshot', { interactive: true });
    const opt = (s2.match(/- option "Ischia" \[[^\]\n]*?ref=(e\d+)/) || [])[1];
    await call('click', { selector: '@' + opt });
    const fills2 = [
      ['textbox', 'Indirizzo sede legale', 'Via Roma 1'], ['textbox', 'CAP', '80077'], ['textbox', 'PEC', 'alfa@pec.it'], ['textbox', 'Nome', 'Mario'],
      ['textbox', 'Cognome', 'Rossi'], ['textbox', 'Email', 'mario@alfa.it'], ['textbox', 'Titolo del piano', 'Competenze digitali 2026'],
      ['spinbutton', 'Numero dipendenti coinvolti', '12'], ['spinbutton', 'Ore di formazione', '40'],
      ['textbox', 'Data fine', '15/12/2026'], ['textbox', 'Descrizione degli obiettivi', 'Sviluppare competenze digitali di base per 12 dipendenti.'],
    ];
    for (const [r, n, v] of fills2) await call('fill', { selector: R(r, n), text: v });
    // il campo data nativo compare come tre spinbutton Month/Day/Year: l'agente usa un selettore CSS
    await call('eval', { script: "const d=document.querySelector('input[type=date]');d.value='2026-11-03';d.dispatchEvent(new Event('change',{bubbles:true}))" });
    await call('check', { selector: R('radio', 'Legale rappresentante') });
    await call('select', { selector: R('combobox', 'Fonte di finanziamento'), values: ['Fondo Nuove Competenze'] });
    // [conferma utente per le dichiarazioni]
    await call('check', { selector: R('checkbox', 'Dichiaro di aver letto') });
    await call('check', { selector: R('checkbox', 'Dichiaro che i dati') });
    await call('click', { selector: R('button', 'Avanti') });
    await call('wait_for_text', { text: 'Riepilogo' });
    const riep = await call('get_text', { selector: 'main' });
    s = await call('snapshot', { interactive: true });
    // [conferma utente per l'invio]
    await call('click', { selector: R('button', 'Invia domanda') });
    s = await call('snapshot', { interactive: true });
    await call('click', { selector: R('button', 'Conferma invio') });
    await call('wait_for_text', { text: 'Protocollo' });
    const fin = await call('get_text', { selector: 'main' });
    okTask = /Riepilogo e invio/.test(riep) && /comune\s+Ischia/.test(riep) && /Protocollo n\. 2026\/004512/.test(fin);
  } else if (task === 'T2') {
    await call('open', { url: base + '/elenco.html' });
    const s = await call('snapshot', { interactive: true, includeUrls: true });
    const m = s.match(/- link "Visualizza" \[[^\]]*?ref=(e\d+)[^\]]*url=[^\]\n]*PF-2026-115[^\n]*|- link "Visualizza" \[ref=(e\d+)\][^\n]*\n\s+- \/url: [^\n]*PF-2026-115/);
    const ref = m && (m[1] || m[2]);
    if (!ref) throw new Error('agent-browser MCP T2: riga non trovata');
    await call('click', { selector: '@' + ref });
    await call('wait_for_text', { text: 'Edizioni' });
    const t2 = await call('get_text', { selector: 'main' });
    okTask = /Ed\. 6/.test(t2) && /PF-2026-115/.test(t2);
  } else if (task === 'T3') {
    await call('open', { url: base + '/index.html' });
    const s = await call('snapshot', { interactive: true });
    await call('click', { selector: '@' + findRef(s, 'link', 'Elenco progetti') });
    await call('wait_for_text', { text: 'progetti trovati' });
    const t3 = await call('get_text', { selector: 'main' });
    okTask = /25 progetti trovati/.test(t3);
  }
  await c.callTool({ name: 'agent_browser_close', arguments: {} }).catch(() => {});
  await c.close();
  return { calls: out, tools, ok: okTask };
}

// ---------------- M6: Fast Playwright MCP 0.2 ----------------
export async function m6(task, base, { VW, VH }) {
  const browser = process.env.TEST_CHROME ? ['--executable-path', process.env.TEST_CHROME] : ['--browser', 'chrome'];
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [FPW_CLI, '--headless', '--isolated', '--no-sandbox', ...browser, '--viewport-size', `${VW},${VH}`],
    stderr: 'pipe',
  });
  const c = new Client({ name: 'bench', version: '1' });
  await c.connect(t);
  const tools = (await c.listTools()).tools;
  const out = [];
  const call = async (name, args) => {
    const t0 = performance.now();
    const r = await c.callTool({ name, arguments: args });
    const text = r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    out.push({ name, args, text, ms: performance.now() - t0 });
    if (r.isError) throw new Error(`Fast Playwright ${name}: ${text.slice(-1500)}`);
    return text;
  };
  // come farebbe un agente: se il blocco si ferma, legge l'errore, corregge il passo e ripete i passi rimasti
  const batchRetry = async (args, fix) => {
    try {
      return await call('browser_batch_execute', args);
    } catch (e) {
      const done = +((String(e.message).match(/Successful: (\d+)/) || [])[1] || 0);
      const rest = args.steps.slice(done);
      rest[0] = fix(rest[0], e.message);
      return call('browser_batch_execute', { ...args, steps: rest });
    }
  };
  const QUIET = { includeSnapshot: false, diffOptions: { enabled: true, format: 'minimal' } };
  const READ_MAIN = { includeSnapshot: true, snapshotOptions: { selector: 'main' } };
  let okTask = false;
  if (task === 'T1') {
    // lo schema di select_option non e' visibile nel catalogo iniziale: l'agente lo cerca
    await call('browser_tools', { action: 'search', query: 'select', includeSchema: true, limit: 1 });
    const s = await call('browser_navigate', { url: base + '/domanda1.html', expectation: { includeSnapshot: true } });
    const ref = (role, name) => [{ ref: findRef(s, role, name) }];
    const type = (role, name, text) => ({ tool: 'browser_type', arguments: { selectors: ref(role, name), text } });
    const sel = (name, v) => ({ tool: 'browser_select_option', arguments: { selectors: ref('combobox', name), values: [v] } });
    await batchRetry({
      steps: [
        { tool: 'browser_click', arguments: { selectors: ref('button', 'Rifiuta') } },
        type('textbox', 'Ragione sociale', 'Alfa Meccanica S.r.l.'),
        type('textbox', 'Partita IVA', '01234567890'),
        type('textbox', 'Codice fiscale azienda', '01234567890'),
        sel('Codice ATECO', '62 - Industrie alimentari (62)'),
        sel('Regione', 'Campania'),
        sel('Provincia', 'Napoli'),
        { tool: 'browser_type', arguments: { selectors: ref('combobox', 'Comune'), text: 'Isch', slowly: true } },
        { tool: 'browser_click', arguments: { selectors: [{ role: 'option', text: 'Ischia' }] } },
        type('textbox', 'Indirizzo sede legale', 'Via Roma 1'),
        type('textbox', 'CAP', '80077'),
        type('textbox', 'PEC', 'alfa@pec.it'),
        type('textbox', 'Nome', 'Mario'),
        type('textbox', 'Cognome', 'Rossi'),
        type('textbox', 'Email', 'mario@alfa.it'),
        { tool: 'browser_click', arguments: { selectors: ref('radio', 'Legale rappresentante') } },
        type('textbox', 'Titolo del piano', 'Competenze digitali 2026'),
        sel('Fonte di finanziamento', 'Fondo Nuove Competenze'),
        type('spinbutton', 'Numero dipendenti coinvolti', '12'),
        type('spinbutton', 'Ore di formazione', '40'),
        type('textbox', 'Data inizio', '2026-11-03'),
        type('textbox', 'Data fine', '15/12/2026'),
        type('textbox', 'Descrizione degli obiettivi', 'Sviluppare competenze digitali di base per 12 dipendenti.'),
      ],
      stopOnFirstError: true,
      globalExpectation: QUIET,
    }, (step, err) => {
      // l'errore "strict mode violation" elenca i candidati con il loro id (<li id="o0" ...>Ischia</li>)
      const id = (err.match(/<li id="(\w+)" role="option">Ischia<\/li>/) || [])[1];
      return id ? { ...step, arguments: { ...step.arguments, selectors: [{ css: '#' + id }] } } : step;
    });
    // [conferma utente per le dichiarazioni]
    let r3;
    try {
      r3 = await call('browser_batch_execute', {
        steps: [
          { tool: 'browser_click', arguments: { selectors: [{ text: 'Dichiaro di aver letto', tag: 'label' }] } },
          { tool: 'browser_click', arguments: { selectors: [{ text: 'Dichiaro che i dati', tag: 'label' }] } },
          { tool: 'browser_click', arguments: { selectors: ref('button', 'Avanti') }, expectation: READ_MAIN },
        ],
        stopOnFirstError: true,
        globalExpectation: QUIET,
      });
    } catch {
      // "Execution context was destroyed": la pagina e' cambiata mentre catturava lo stato; l'agente rilegge la pagina
      r3 = await call('browser_snapshot', { expectation: READ_MAIN });
      for (let k = 0; k < 2 && !/Riepilogo e invio/.test(r3); k++) r3 = await call('browser_snapshot', { expectation: READ_MAIN });
    }
    // [conferma utente per l'invio]
    const r4 = await call('browser_batch_execute', {
      steps: [
        { tool: 'browser_click', arguments: { selectors: [{ role: 'button', text: 'Invia domanda' }] } },
        { tool: 'browser_click', arguments: { selectors: [{ role: 'button', text: 'Conferma invio' }] }, expectation: READ_MAIN },
      ],
      stopOnFirstError: true,
      globalExpectation: QUIET,
    });
    okTask = /Riepilogo e invio/.test(r3) && /Ischia/.test(r3) && /Protocollo n\. 2026\/004512/.test(r4);
  } else if (task === 'T2') {
    const s = await call('browser_navigate', { url: base + '/elenco.html', expectation: { includeSnapshot: true } });
    const m = s.match(/cell "PF-2026-115"[^\n]*\n(?:\s+-[^\n]*\n)*?\s+- link "Visualizza" \[ref=(e\d+)\]/);
    if (!m) throw new Error('Fast Playwright T2: riga non trovata');
    const t2 = await call('browser_batch_execute', { steps: [{ tool: 'browser_click', arguments: { selectors: [{ ref: m[1] }] }, expectation: READ_MAIN }], globalExpectation: QUIET });
    okTask = /Ed\. 6/.test(t2) && /PF-2026-115/.test(t2);
  } else if (task === 'T3') {
    const s = await call('browser_navigate', { url: base + '/index.html', expectation: { includeSnapshot: true } });
    const t3 = await call('browser_batch_execute', { steps: [{ tool: 'browser_click', arguments: { selectors: [{ ref: findRef(s, 'link', 'Elenco progetti') }] }, expectation: READ_MAIN }], globalExpectation: QUIET });
    okTask = /25 progetti trovati/.test(t3);
  }
  await c.close();
  return { calls: out, tools, ok: okTask };
}

/** Token delle istruzioni che l'agente ha sempre nel contesto con agent-browser CLI (skill di discovery installata). */
export function agentBrowserSkillStub() {
  return fs.readFileSync(path.join(path.dirname(require.resolve('agent-browser/package.json')), 'skills', 'agent-browser', 'SKILL.md'), 'utf8');
}
