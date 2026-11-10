// Modalita' "Chrome reale": Chrome normale dell'utente (non avviato da Playwright, quindi senza i segni di
// automazione) con la porta di debug aperta. Colibri vi si collega via CDP e non lo chiude mai.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export function findChrome(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  const env = process.env;
  const c =
    process.platform === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((b) => [
          path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ])
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
  return c.find((p) => fs.existsSync(p)) || null;
}

export function realProfileDir(base) {
  return base || path.join(os.homedir(), '.colibri', 'real-chrome');
}

/** Cartelle dei profili di tutti i giorni (Chrome, Beta, Canary, Edge, Brave, Chromium) del sistema corrente. */
export function userDataDirs() {
  const h = os.homedir();
  if (process.platform === 'win32') {
    const l = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
    return [['Google', 'Chrome'], ['Google', 'Chrome Beta'], ['Google', 'Chrome SxS'], ['Microsoft', 'Edge'], ['BraveSoftware', 'Brave-Browser'], ['Chromium']].map((p) => path.join(l, ...p, 'User Data'));
  }
  if (process.platform === 'darwin') {
    const s = path.join(h, 'Library', 'Application Support');
    return ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Chromium'].map((p) => path.join(s, p));
  }
  const c = process.env.XDG_CONFIG_HOME || path.join(h, '.config');
  return ['google-chrome', 'google-chrome-beta', 'google-chrome-unstable', 'microsoft-edge', 'BraveSoftware/Brave-Browser', 'chromium'].map((p) => path.join(c, p));
}

const portOpen = (port, ms = 600) =>
  new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const end = (v) => {
      s.destroy();
      res(v);
    };
    s.setTimeout(ms, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });

/**
 * Chrome gia' aperto dall'utente con il debug remoto attivo (chrome://inspect/#remote-debugging, Chrome 144+,
 * oppure --remote-debugging-port): Chrome scrive porta e percorso WebSocket in <profilo>/DevToolsActivePort.
 * Ritorna { ws, port, dir } del file piu' recente con la porta ancora in ascolto, altrimenti null.
 */
export async function findRunningChrome(dirs = userDataDirs()) {
  const found = [];
  for (const d of dirs) {
    const f = path.join(d, 'DevToolsActivePort');
    try {
      const [port, wsPath] = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      if (/^\d+$/.test(port.trim()) && /^\/devtools\/browser\//.test((wsPath || '').trim())) found.push({ port: +port.trim(), wsPath: wsPath.trim(), dir: d, t: fs.statSync(f).mtimeMs });
    } catch {}
  }
  found.sort((a, b) => b.t - a.t);
  for (const x of found) if (await portOpen(x.port)) return { ws: `ws://127.0.0.1:${x.port}${x.wsPath}`, port: x.port, dir: x.dir };
  return null;
}

export async function cdpAlive(cdpUrl, ms = 1500) {
  try {
    const r = await fetch(new URL('/json/version', cdpUrl), { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Avvia Chrome staccato dal processo di Colibri: se il client MCP chiude o riavvia il server (anche uccidendo
 * l'albero dei processi), Chrome resta aperto. Ritorna il percorso usato.
 */
export async function launchRealChrome({ cdpUrl = 'http://127.0.0.1:9222', chromePath, profileDir, url } = {}) {
  const u = new URL(cdpUrl);
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) throw new Error(`${cdpUrl} non e' locale: avvia Chrome a mano su quella macchina`);
  const exe = findChrome(chromePath);
  if (!exe) throw new Error('Chrome non trovato: indica il percorso con CB_CHROME_PATH');
  const dir = realProfileDir(profileDir);
  fs.mkdirSync(dir, { recursive: true });
  const args = [`--remote-debugging-port=${u.port || 9222}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check'];
  if (url) args.push(url);
  // Windows: "start" fa partire Chrome da un cmd che termina subito, cosi' Chrome non risulta figlio di Colibri
  const child =
    process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'start', '""', `"${exe}"`, ...args.map((a) => `"${a}"`)], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      : spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  for (let k = 0; k < 40; k++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await cdpAlive(cdpUrl, 800)) return exe;
  }
  throw new Error(`Chrome avviato (${exe}) ma la porta ${u.port || 9222} non risponde: forse il profilo ${dir} e' gia' aperto senza porta di debug, chiudi quella finestra`);
}
