// Client MCP reale: avvia il server via stdio, come fa Claude Desktop.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));

/** Cartella temporanea per profili, download e risultati dei test. */
export const TMP = path.join(os.tmpdir(), 'colibri-test');

/**
 * Ambiente di test. Per default Chrome o Edge vengono trovati da soli, senza finestra.
 * TEST_CHROME=/percorso/chrome per un browser specifico, TEST_HEADLESS=false per vederlo.
 */
export const TEST_ENV = {
  CB_CHROME_PATH: process.env.TEST_CHROME || '',
  CB_HEADLESS: process.env.TEST_HEADLESS ?? 'true',
  CB_EXTRA_ARGS: process.env.TEST_CHROME_ARGS ?? '--no-sandbox --disable-dev-shm-usage',
  // nei test una verifica non apre mai una finestra visibile
  CB_HUMAN_SHOW: 'false',
};

export const SERVER_ENTRY = process.env.TEST_SERVER || path.join(here, '../extension/server/index.js');

export async function connect(env = {}, serverEntry = SERVER_ENTRY) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, ...TEST_ENV, ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport);
  const calls = [];
  const call = async (name, args = {}) => {
    const t0 = performance.now();
    const r = await client.callTool({ name, arguments: args });
    const ms = performance.now() - t0;
    const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const image = r.content.find((c) => c.type === 'image');
    calls.push({ name, args, text, ms, isError: !!r.isError, image: image ? image.data.length : 0 });
    return { text, isError: !!r.isError, ms, image };
  };
  return { client, call, calls, close: () => client.close() };
}
