// Modalita' "Chrome reale": Chrome normale dell'utente (non avviato da Playwright, quindi senza i segni di
// automazione) con la porta di debug aperta. Colibri vi si collega via CDP e non lo chiude mai.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
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
