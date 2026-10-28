// Robustezza: finestra chiusa dall'utente durante la sessione, percorso di Chrome errato.
import { connect, TEST_ENV, TMP } from './mcp-client.mjs';
import { serve } from './server.mjs';
import { Session, loadConfig } from '../extension/server/lib/session.js';

const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${!ok && detail ? '\n      ' + detail : ''}`);
};

// 1. l'utente chiude la finestra del browser: la chiamata successiva lo riapre
const S = new Session(loadConfig({ ...TEST_ENV, CB_PROFILE_DIR: TMP + '/prof-res' }));
await S.open(base + '/index.html');
await S.ctx.close();
const t = await S.open(base + '/elenco.html');
check(t.includes('Elenco progetti'), 'browser riaperto dopo la chiusura della finestra');
await S.close();

// 2. percorso di Chrome errato: messaggio d'errore chiaro, nessun crash del server
const c = await connect({ CB_CHROME_PATH: '/percorso/inesistente/chrome', CB_PROFILE_DIR: TMP + '/prof-x' });
const r = await c.call('browse_open', { url: base + '/index.html' });
check(r.isError && r.text.includes('Impossibile avviare Chrome o Edge'), 'percorso di Chrome errato: errore chiaro', r.text);
const r2 = await c.call('browse_stats', {});
check(!r2.isError, 'il server resta attivo dopo l\'errore', r2.text);
await c.close();

srv.close();
console.log(fail ? `${fail} falliti` : 'tutti superati');
process.exit(fail ? 1 : 0);
