<div align="center">

<img src="docs/assets/hero.svg" alt="compact-browser-mcp — your AI drives Chrome by reading text, not screenshots" width="100%"/>

<h3>The token-frugal browser for AI agents.<br/>Same tasks. <b>89× fewer tokens</b> than screenshots, <b>11× fewer</b> than Playwright MCP.</h3>

<p>
<a href="https://github.com/t4zxxx1/compact-browser-mcp/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/t4zxxx1/compact-browser-mcp?style=for-the-badge&color=22d3ee&labelColor=0d1117"/></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-a78bfa?style=for-the-badge&labelColor=0d1117"/></a>
<a href="https://modelcontextprotocol.io"><img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-34d399?style=for-the-badge&labelColor=0d1117"/></a>
<img alt="Jev tokens" src="https://img.shields.io/badge/Jev%20tokens-0-f59e0b?style=for-the-badge&labelColor=0d1117"/>
<a href="https://github.com/t4zxxx1/compact-browser-mcp/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/t4zxxx1/compact-browser-mcp?style=for-the-badge&color=f472b6&labelColor=0d1117"/></a>
</p>

<p>
<a href="https://insiders.vscode.dev/redirect/mcp/install?name=compact-browser&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3At4zxxx1%2Fcompact-browser-mcp%22%5D%7D"><img alt="Install in VS Code" src="https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white"/></a>
<a href="https://cursor.com/en/install-mcp?name=compact-browser&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdpdGh1Yjp0NHp4eHgxL2NvbXBhY3QtYnJvd3Nlci1tY3AiXX0="><img alt="Install in Cursor" src="https://img.shields.io/badge/Cursor-Install-000000?style=flat-square&logo=cursor&logoColor=white"/></a>
<a href="https://github.com/t4zxxx1/compact-browser-mcp/releases/latest/download/compact-browser.mcpb"><img alt="Claude Desktop" src="https://img.shields.io/badge/Claude_Desktop-.mcpb-D97757?style=flat-square&logo=anthropic&logoColor=white"/></a>
</p>

**English** · [Italiano](README.it.md)

</div>

---

## Why

AI agents browse the web in the most expensive way possible: a **screenshot costs ~1,366 tokens**, an accessibility-tree dump **4,400–7,700 tokens per page**, and every extra tool call makes the model **re-read the whole conversation**.

**compact-browser-mcp** turns each page into a few hundred tokens of plain rows — fields, values, state, risk flags — runs **many steps in one call**, answers with **only what changed**, and fills forms with a **local Jev-style engine** that needs no API key and costs **zero tokens**.

- ⚡ **27,760 tokens** for a 22-field, two-page application — vs 318,910 with Playwright MCP and 2.48 M with screenshots
- 🧠 **Jev-style typed decisions, locally**: 98.6% accuracy, AUROC 0.95, **1.7 ms** per match, **$0**
- 🔌 **Any MCP client**: Claude Desktop & Code, GitHub Copilot (VS Code), Cursor, Windsurf, Codex, Gemini CLI…
- 🛡️ **Safe by default**: submit/pay/delete need your OK (`!c`), passwords/cards/OTP are never typed by the AI (`!x`)
- 🏠 **100% local**: your Chrome profile, your logins, nothing goes through third-party servers

<div align="center">
<img src="docs/assets/terminal.svg" alt="browse_task demo: 21 user labels mapped to 21 fields without reading the page" width="100%"/>
</div>

## Install in 30 seconds

Requires **Node.js ≥ 18** and **Google Chrome or Microsoft Edge**. The server starts with:

```bash
npx -y github:t4zxxx1/compact-browser-mcp
```

<details open>
<summary><b>Claude Desktop</b> — one click</summary>

Download **[compact-browser.mcpb](https://github.com/t4zxxx1/compact-browser-mcp/releases/latest/download/compact-browser.mcpb)** and double-click it. Settings (allowed domains, headless, profile folder…) appear in *Settings → Extensions*.

</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add compact-browser -- npx -y github:t4zxxx1/compact-browser-mcp
```
</details>

<details>
<summary><b>GitHub Copilot in VS Code</b></summary>

Click the **Install in VS Code** badge above, or add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "compact-browser": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:t4zxxx1/compact-browser-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Cursor · Windsurf · Gemini CLI · Cline · any <code>mcpServers</code> client</b></summary>

`~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.gemini/settings.json`, Claude Desktop's `claude_desktop_config.json`…

```json
{
  "mcpServers": {
    "compact-browser": {
      "command": "npx",
      "args": ["-y", "github:t4zxxx1/compact-browser-mcp"],
      "env": { "CB_ALLOWED_DOMAINS": "" }
    }
  }
}
```
</details>

<details>
<summary><b>OpenAI Codex CLI</b></summary>

`~/.codex/config.toml`:

```toml
[mcp_servers.compact-browser]
command = "npx"
args = ["-y", "github:t4zxxx1/compact-browser-mcp"]
```
</details>

<details>
<summary><b>From source</b> (no npx, fastest startup)</summary>

```bash
git clone https://github.com/t4zxxx1/compact-browser-mcp
cd compact-browser-mcp && npm ci --omit=dev
# then point your client to:  node /path/to/compact-browser-mcp/extension/server/index.js
```
</details>

> **Windows tip:** if your client can't find `npx`, use `"command": "cmd", "args": ["/c", "npx", "-y", "github:t4zxxx1/compact-browser-mcp"]`.

Then just ask: *"Open the supplier portal and fill in the application with these details: …"* — or *"Use the compact browser to read the editions of project PF-2026-115"*.

## Better than Jev — with real numbers

[Jev](https://jevai.net) popularised the **"System One" idea**: answer typed questions with a calibrated confidence and act only above a threshold. It is excellent — and it is a **paid cloud model** with its own tokens and API key.

compact-browser-mcp ships **the same idea as a local engine** inside the MCP server, specialised for the one decision a browsing agent makes all the time: *which form field does this piece of data go into?* Your existing Claude/Copilot subscription is all you pay.

<div align="center">
<img src="docs/assets/jev-vs-local.svg" alt="Jev 1.14 vs local engine: accuracy, calibration, AUROC, latency, cost" width="100%"/>
</div>

| | Jev 1.14 ([System One Bench](https://systemonebench.dev)) | **compact-browser local engine v0.4** |
|---|---|---|
| Choice accuracy | 75.7% | **98.6%** (419 cases) · **87.9%** on the independent Test 5 |
| Calibration error (ECE) | 8.4% (choice) · 6.0% overall | **5.9%** · **4.6%** on Test 5 |
| Confidence AUROC | 0.81 | **0.95** |
| Latency | 136 ms p50 · 175 ms p95 | **1.7 ms p50 · 8.3 ms p95** (≈80× faster) |
| Cost | $0.028 per 1,000 calls + API key | **$0, no key, no network** |
| Wrong autonomous actions | — | **0** (100% precision when it acts alone) |
| Scope | any domain (trained model) | web forms only (heuristics + vocabulary) |

> **Honest note.** The datasets differ: Jev 1.14 was measured on 2,450 general choice questions, the local engine on 419 form-matching cases from test pages written by the author (the independent Test 5 was written *after* the engine changes and measured once). Jev is a generalist; this engine does one job and is tuned for it. Read it as an order of magnitude, not a leaderboard. Full method: [docs/calibrazione.md](docs/calibrazione.md).

## Benchmarks

Same pages, same tasks, eight methods. Every method completed every task. **"Total context"** is the sum of tokens the model re-reads across all turns — what actually drives cost and latency.

<div align="center">
<img src="docs/assets/token-race.svg" alt="Total context tokens for task T1 across eight browser methods" width="100%"/>
</div>

| Task | Screenshots | Playwright MCP | agent-browser MCP | Fast Playwright MCP | **compact-browser** |
|---|---|---|---|---|---|
| **T1** 22-field form, 2 pages | 2,480,688 · 154 s | 318,910 · 52 s | 1,373,730 · 108 s | 115,624 · 57 s | **27,760 · 19 s** |
| **T2** list → detail table | 34,630 · 13 s | 73,333 · 15 s | 167,751 · 18 s | 37,480 · 12 s | **20,700 · 10 s** |
| **T3** navigate a heavy home | 23,809 · 10 s | 69,739 · 15 s | 148,169 · 17 s | 36,480 · 12 s | **12,849 · 8 s** |
| Reading one form page | 1,366 (image) | 5,354 | 4,464 | 5,283 | **628** |
| Tool definitions, every turn | — | 4,536 | — | — | **1,347** |

Full tables, assumptions and caveats (the test pages were built alongside this tool, so it plays at home): [docs/benchmark.md](docs/benchmark.md).

## How it works

<div align="center">
<img src="docs/assets/pipeline.svg" alt="Agent → compact-browser-mcp (rows, engine, safety gate) → Chrome" width="100%"/>
</div>

1. **Page → rows.** A script inside the page keeps only what you can act on: fields, menus, buttons, links, checkboxes — with name, value, state (`req`, `inv`, `off`) and a risk flag. Header, nav and footer are folded; repeated table rows are compressed.
2. **Many steps, one call.** `browse_do` runs up to 40 steps (fill, select, check, click, wait, read) and keeps going across page changes, because targets can be named.
3. **Diff only.** After acting, the model gets verified writes, changed/new elements, form errors and new text (`»Application sent, protocol n. …`) — not the whole page again.
4. **Guided tasks.** With `browse_task` the model doesn't even look at the form: it passes the user's own labels (`"VAT": "01234567890"`, `"start date": "03/11/2026"`) and the local engine decides which field is which, with a calibrated probability. Above the threshold it acts; below, it asks.

### What the model sees

```
http://127.0.0.1:8811/domanda1.html | Nuova domanda - passo 1 di 2
h1: Richiesta di contributo per piano formativo · scroll 0/1747
[fs "Dati dell'azienda"]
e28 text "Ragione sociale" req
e31 sel "Codice ATECO" ="Seleziona" opz:97 req
e33 sel "Provincia" ="Seleziona prima la regione" off req
e34 combo "Comune" req col
[fs "Dichiarazioni"]
e54 chk "Dichiaro di aver letto l'informativa privacy e accetto il t…" [ ] req !c
e56 btn "Salva bozza" !c
e57 btn "Avanti"
[nascosti 73 in hdr,search,nav,ftr: scope:"all" o filter]
```

After 22 steps in **one** call, the entire answer is:

```
ok 22/22
---
16 campi impostati come richiesto · 5 altre variazioni
~ e31 "Codice ATECO" ="62 - Industrie alimentari (62)" req
~ e33 "Provincia" ="Napoli" req
~ e34 "Comune" ="Pozzuoli" req col
```

> Tool descriptions are in terse English for the model; page output keeps the page's language. It works on any site, in any language — keywords for submit, consent, passwords, cards and cookie banners are recognised in English, Italian, French, Spanish, German and Portuguese.

## Tools

| Tool | What it does |
|---|---|
| `browse_open` | Open a URL (auto-starts Chrome), reject non-essential cookies, return the rows |
| `browse_view` | Rows of the current page, with `filter`, `scope:"all"` and paging |
| `browse_do` | Up to 40 steps in order; returns only the diff |
| `browse_read` | Read without acting: `text`, `table`, `find`, `describe` |
| `browse_task` | Jev-style guided task: params by human labels, `answers`, `submit`, `expect`, typed `extract` (text, number, money, date, url, table) |
| `browse_screenshot` | Small JPEG (~900 tokens) of the window, an element or a region — only when text is not enough |
| `browse_stats` | Tokens used this session vs screenshots |

## Safety

- **`!c` side effects** — submit, confirm, save, delete, pay, accept terms, upload: blocked until the user says OK, then repeated with `"confirm": true`.
- **`!x` secrets** — passwords, card numbers, CVV, OTP, IBAN: the AI can never type them, not even with confirmation. You type them in the window.
- **Guided tasks** act alone only above the confidence threshold; submit never fires with open questions, errors or empty required fields.
- **Allowed domains**, no `file://` / `javascript:`, page text treated as untrusted data (prompt-injection resistant), refs unique per session.

## Configuration

| Env var | Default | |
|---|---|---|
| `CB_ALLOWED_DOMAINS` | all | comma-separated allow-list |
| `CB_CONFIRM_SENSITIVE` | `true` | keep it on |
| `CB_HEADLESS` | `false` | invisible browser |
| `CB_PROFILE_DIR` | `~/.compact-browser/profile` | logins and cookies live here |
| `CB_DOWNLOADS_DIR` | `~/Downloads` | |
| `CB_CHROME_PATH` | auto | only if Chrome/Edge is not found |
| `CB_ALLOW_SCREENSHOT` | `true` | |
| `CB_MODE` / `CB_CDP_URL` | `launch` | `cdp` attaches to **your own running Chrome** started with `--remote-debugging-port=9222` |

## Limits

- Charts, canvas and maps have no text: the agent falls back to the small screenshot (with refs drawn on it) and relative-coordinate clicks.
- The `browse_task` engine is a calibrated vocabulary, not a trained model: with unknown jargon it asks more often (never acts wrongly). Answers are remembered per site.
- CAPTCHAs and logins are done by you, in the window.
- Tested on pages modelled on public-administration portals: please report sites that don't work in [Issues](https://github.com/t4zxxx1/compact-browser-mcp/issues).

## Development

```bash
npm ci            # dev + runtime deps
npm test          # 120+ end-to-end tests over the real MCP protocol (needs Chrome or Edge)
npm run bench     # vs screenshots, Playwright MCP, agent-browser, Fast Playwright MCP
npm run calibrate # engine calibration (VERIFY5=1 adds the independent Test 5)
npm run build     # dist/compact-browser.mcpb
```

Docs (Italian): [how it works](docs/come-funziona.md) · [benchmark](docs/benchmark.md) · [calibration & Jev comparison](docs/calibrazione.md).
Release: bump `version` in `package.json`, `extension/manifest.json`, `extension/server/package.json`, then `git tag vX.Y.Z && git push --tags` — CI tests, builds the `.mcpb` and publishes it.

## Support the project

If it saves you tokens, **⭐ star the repo** — it's the best way to help others find it. Ideas, bugs and sites to support: [open an issue](https://github.com/t4zxxx1/compact-browser-mcp/issues). Made with care in Italy by **[@t4zxxx1](https://github.com/t4zxxx1)** · Roca Software.

## License

MIT — see [LICENSE](LICENSE). © 2026 Roca Software.
