import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'fixtures');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.pdf':'application/pdf' };
// PDF minimo valido con una riga per elemento di lines (Helvetica, flusso non compresso)
export function miniPdf(lines) {
  const body = 'BT /F1 12 Tf 72 720 Td ' + lines.map((l, k) => (k ? '0 -16 Td ' : '') + '(' + l.replace(/[()\\]/g, '\\$&') + ') Tj').join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let s = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, k) => { off.push(s.length); s += `${k + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length; s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  return s + `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
}
export function serve(port = 0) { return new Promise(res => { const s = http.createServer((req, rsp) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/slow') { const ms = +new URL(req.url, 'http://x').searchParams.get('ms') || 1000; return setTimeout(() => { rsp.writeHead(200, { 'content-type': 'text/plain' }); rsp.end('ok dopo ' + ms + ' ms'); }, ms); }
  if (p === '/ricevuta.pdf') { rsp.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ricevuta.pdf"' }); return rsp.end('%PDF-1.4\n%demo\n'); }
  if (p === '/biglietto.pdf') { rsp.writeHead(200, { 'content-type': 'application/pdf' }); return rsp.end(miniPdf(['Biglietto treno Wien Hbf - Salzburg Hbf', 'Partenza 08:30 arrivo 11:02', 'Totale EUR 59,90']), 'latin1'); }
  const f = path.join(dir, path.normalize(p)); if (!f.startsWith(dir) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end('nf'); }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rsp); });
  s.listen(port, '127.0.0.1', () => res(s)); }); }
if (process.argv[1] === url.fileURLToPath(import.meta.url)) serve(+process.argv[2] || 8765).then(s => console.log('http://127.0.0.1:' + s.address().port));
