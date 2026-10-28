import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'fixtures');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.pdf':'application/pdf' };
export function serve(port = 0) { return new Promise(res => { const s = http.createServer((req, rsp) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/slow') { const ms = +new URL(req.url, 'http://x').searchParams.get('ms') || 1000; return setTimeout(() => { rsp.writeHead(200, { 'content-type': 'text/plain' }); rsp.end('ok dopo ' + ms + ' ms'); }, ms); }
  if (p === '/ricevuta.pdf') { rsp.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ricevuta.pdf"' }); return rsp.end('%PDF-1.4\n%demo\n'); }
  const f = path.join(dir, path.normalize(p)); if (!f.startsWith(dir) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end('nf'); }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rsp); });
  s.listen(port, '127.0.0.1', () => res(s)); }); }
if (process.argv[1] === url.fileURLToPath(import.meta.url)) serve(+process.argv[2] || 8765).then(s => console.log('http://127.0.0.1:' + s.address().port));
