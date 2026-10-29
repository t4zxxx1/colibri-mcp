// Crea dist/colibri.mcpb: copia extension/, installa solo le dipendenze di esecuzione e impacchetta.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const out = path.join(root, 'dist');
const build = path.join(out, 'build');
const mcpb = path.join(root, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');

const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const serverPkg = JSON.parse(fs.readFileSync(path.join(ext, 'server/package.json'), 'utf8'));
if (manifest.version !== pkg.version || serverPkg.version !== pkg.version) {
  console.error(`Versioni diverse: package.json ${pkg.version}, manifest ${manifest.version}, server ${serverPkg.version}`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(ext, build, { recursive: true, filter: (src) => path.basename(src) !== 'node_modules' });
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: path.join(build, 'server'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
// interfacce grafiche di Playwright (trace viewer, recorder, report HTML): non servono a runtime
fs.rmSync(path.join(build, 'server/node_modules/playwright-core/lib/vite'), { recursive: true, force: true });

execFileSync(process.execPath, [mcpb, 'validate', path.join(build, 'manifest.json')], { stdio: 'inherit' });
execFileSync(process.execPath, [mcpb, 'pack', build, path.join(out, 'colibri.mcpb')], { stdio: 'inherit' });
console.log(`\nPronto: ${path.join(out, 'colibri.mcpb')} (versione ${pkg.version})`);
