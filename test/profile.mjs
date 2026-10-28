import { Session, loadConfig } from '../extension/server/lib/session.js';
import { serve } from './server.mjs';
import { TEST_ENV, TMP } from './mcp-client.mjs';
const SCR = TMP;
const srv = await serve(); const base = 'http://127.0.0.1:' + srv.address().port;
const S = new Session(loadConfig({ ...TEST_ENV, CB_PROFILE_DIR: SCR + '/prof-prof' }));
let t = performance.now(); await S.ensure(); console.log('avvio browser', Math.round(performance.now()-t), 'ms');
for (const u of ['index.html','domanda1.html','elenco.html','test.html','extra.html']) {
  await S.page.goto(base + '/' + u); await S.settle(S.page, 3000, 200);
  const ts = [];
  for (let k = 0; k < 5; k++) { const a = performance.now(); const snap = await S.collect(); ts.push(performance.now() - a); if (k===0) var n = snap.items.length; }
  ts.sort((a,b)=>a-b);
  const dom = await S.page.evaluate(() => document.getElementsByTagName('*').length);
  console.log(`${u.padEnd(14)} nodi DOM ${String(dom).padStart(5)}  elementi ${String(n).padStart(4)}  collect mediana ${ts[2].toFixed(1)} ms (min ${ts[0].toFixed(1)})`);
}
// costo per passo: 20 fill sulla stessa pagina
await S.page.goto(base + '/domanda1.html'); await S.settle(S.page, 3000, 200);
const names = ['Ragione sociale','Partita IVA','Indirizzo sede legale','CAP','PEC','Telefono','Nome','Cognome','Email','Titolo del piano'];
t = performance.now(); await S.run(names.map(n => ({ fill: n, text: 'x' + n.length }))); const tf = performance.now() - t;
console.log(`10 fill in un blocco: ${Math.round(tf)} ms (${Math.round(tf/10)} ms/passo)`);
await S.close(); srv.close();
