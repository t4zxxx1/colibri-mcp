<div align="center">

<img src="docs/assets/hero.svg" alt="Colibri MCP — il browser colibrì per agenti AI" width="100%"/>

<h3>🐦 Il browser colibrì per agenti AI — piccolo, veloce, preciso.<br/>Stessi compiti. <b>89× meno token</b> degli screenshot, <b>11× meno</b> di Playwright MCP.</h3>

<p>
<a href="https://github.com/t4zxxx1/colibri-mcp/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/t4zxxx1/colibri-mcp?style=for-the-badge&color=22d3ee&labelColor=0d1117"/></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/licenza-MIT-a78bfa?style=for-the-badge&labelColor=0d1117"/></a>
<a href="https://modelcontextprotocol.io"><img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-34d399?style=for-the-badge&labelColor=0d1117"/></a>
<img alt="Token Jev" src="https://img.shields.io/badge/token%20Jev-0-f59e0b?style=for-the-badge&labelColor=0d1117"/>
<a href="https://github.com/t4zxxx1/colibri-mcp/stargazers"><img alt="Stelle" src="https://img.shields.io/github/stars/t4zxxx1/colibri-mcp?style=for-the-badge&color=f472b6&labelColor=0d1117"/></a>
</p>

<p>
<a href="https://insiders.vscode.dev/redirect/mcp/install?name=colibri&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3At4zxxx1%2Fcolibri-mcp%22%5D%7D"><img alt="Installa in VS Code" src="https://img.shields.io/badge/VS_Code-Installa-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white"/></a>
<a href="https://cursor.com/en/install-mcp?name=colibri&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdpdGh1Yjp0NHp4eHgxL2NvbGlicmktbWNwIl19"><img alt="Installa in Cursor" src="https://img.shields.io/badge/Cursor-Installa-000000?style=flat-square&logo=cursor&logoColor=white"/></a>
<a href="https://github.com/t4zxxx1/colibri-mcp/releases/latest/download/colibri.mcpb"><img alt="Claude Desktop" src="https://img.shields.io/badge/Claude_Desktop-.mcpb-D97757?style=flat-square&logo=anthropic&logoColor=white"/></a>
<a href="#installazione-in-una-riga"><img alt="Claude Code" src="https://img.shields.io/badge/Claude_Code-1_riga-D97757?style=flat-square&logo=anthropic&logoColor=white"/></a>
<a href="#installazione-in-una-riga"><img alt="OpenAI Codex" src="https://img.shields.io/badge/Codex-1_riga-412991?style=flat-square"/></a>
<a href="#installazione-in-una-riga"><img alt="Copilot CLI" src="https://img.shields.io/badge/Copilot_CLI-1_riga-24292f?style=flat-square&logo=githubcopilot&logoColor=white"/></a>
<a href="#installazione-in-una-riga"><img alt="Gemini CLI" src="https://img.shields.io/badge/Gemini_CLI-1_riga-4285F4?style=flat-square&logo=googlegemini&logoColor=white"/></a>
</p>

<b>Una riga, qualsiasi agente</b> — niente account, niente chiave API, niente build:

</div>

```bash
claude mcp add colibri -- npx -y github:t4zxxx1/colibri-mcp     # oppure: codex / copilot mcp add …
```

<div align="center">

**[Perché](#perché-colibri)** · **[Installa](#installazione-in-una-riga)** · **[VS Code](#vs-code--passo-per-passo)** · **[vs Jev](#meglio-di-jev--con-i-numeri-veri)** · **[Benchmark](#benchmark)** · **[Come funziona](#come-funziona)** · **[Tool](#tool)** · **[Sicurezza](#sicurezza)** · **[Impostazioni](#impostazioni)** · **[FAQ](#domande-frequenti)**

[English](README.md) · **Italiano**

</div>

---

## Perché Colibri

Un colibrì pesa circa 3 grammi, batte le ali una cinquantina di volte al secondo e resta sospeso con precisione millimetrica. L'idea è questa: **il browser più leggero possibile per un agente AI**, veloce ed esatto.


Gli agenti AI navigano nel modo più costoso possibile: **uno screenshot costa ~1.366 token**, un albero di accessibilità **4.400–7.700 token a pagina**, e ogni chiamata in più costringe il modello a **rileggere tutta la conversazione**.

**Colibri** trasforma ogni pagina in poche centinaia di token di righe di testo — campi, valori, stato, segnali di rischio — esegue **molti passi in una sola chiamata**, risponde **solo con ciò che è cambiato** e compila i moduli con un **motore locale in stile Jev** che non richiede chiavi API e costa **zero token**.

- ⚡ **27.760 token** per una domanda di 22 campi su due pagine — contro 318.910 con Playwright MCP e 2,48 milioni con gli screenshot
- 🧠 **Decisioni tipizzate in stile Jev, in locale, e davanti a Jev 1.14 nella compilazione dei moduli**:

  | | Jev 1.14 ([System One Bench](https://systemonebench.dev) pubblico, 2.450 domande di scelta) | Colibri v0.4 (419 casi di abbinamento campo-dato) |
  |---|---|---|
  | Accuratezza | 75,7% | **98,6%** · **87,9%** su un modulo mai visto |
  | AUROC della confidenza | 0,81 | **0,95** |
  | Latenza p50 | 136 ms | **1,7 ms** |
  | Costo | 0,028 $ ogni 1.000 chiamate + chiave API | **0, nessuna chiave** |

  I due insiemi di dati sono diversi, quindi va letto come ordine di grandezza: Jev copre qualsiasi argomento, Colibri fa un solo lavoro (dato → campo del modulo). Metodo e avvertenze sono in [Meglio di Jev](#meglio-di-jev--con-i-numeri-veri).
- 🔌 **Una riga in qualsiasi agente**: Claude Code, OpenAI Codex, GitHub Copilot (CLI e VS Code), Gemini CLI, Cursor, Claude Desktop, Windsurf… — [ecco come](#installazione-in-una-riga)
- 🛡️ **Sicuro per default**: invio/pagamento/eliminazione chiedono il tuo ok (`!c`), password/carte/OTP non vengono mai scritti dall'AI (`!x`)
- 🏠 **100% locale**: il tuo profilo Chrome, i tuoi accessi, nessun dato passa da server di terzi

<div align="center">
<img src="docs/assets/terminal.svg" alt="Demo di browse_task: 21 etichette dell'utente abbinate a 21 campi senza leggere la pagina" width="100%"/>
</div>

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Installazione in una riga

<div align="center">
<img src="docs/assets/agents.svg" alt="Una riga, qualsiasi agente: Claude Code, Codex, Copilot CLI, Gemini CLI, VS Code, Claude Desktop, Cursor, Windsurf" width="100%"/>
</div>

Servono solo **Node.js ≥ 18** e **Chrome o Edge**. Niente account, niente chiave API, niente compilazione: `npx` scarica Colibri da GitHub e lo avvia sul tuo computer.

| Il tuo agente | Installazione |
|---|---|
| **Claude Code** | `claude mcp add colibri -- npx -y github:t4zxxx1/colibri-mcp` |
| **OpenAI Codex** (CLI + estensione IDE) | `codex mcp add colibri -- npx -y github:t4zxxx1/colibri-mcp` |
| **GitHub Copilot CLI** | `copilot mcp add colibri -- npx -y github:t4zxxx1/colibri-mcp` |
| **GitHub Copilot in VS Code** | [**un clic**](https://insiders.vscode.dev/redirect/mcp/install?name=colibri&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3At4zxxx1%2Fcolibri-mcp%22%5D%7D) · oppure `code --add-mcp …` — [tutti i modi](#vs-code--passo-per-passo) |
| **Gemini CLI** | `gemini mcp add -s user colibri npx -y github:t4zxxx1/colibri-mcp` |
| **Claude Desktop** | scarica [**colibri.mcpb**](https://github.com/t4zxxx1/colibri-mcp/releases/latest/download/colibri.mcpb) → doppio clic |
| **Cursor** | [**un clic**](https://cursor.com/en/install-mcp?name=colibri&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdpdGh1Yjp0NHp4eHgxL2NvbGlicmktbWNwIl19) |
| **Cline** (VS Code) | incolla il JSON in *MCP Servers → Configure* — [passo per passo](#vs-code--passo-per-passo) |
| **Windsurf · Roo · qualsiasi altro client** | incolla il [JSON di 3 righe](#configurazione-manuale) |

**Poi basta chiedere** — *"Apri il portale fornitori e compila la domanda con questi dati: …"* oppure *"Con Colibri leggimi le edizioni del progetto PF-2026-115"*. Chrome si apre alla prima chiamata; fai l'accesso una volta e se lo ricorda.

### VS Code — passo per passo

Colibri funziona in VS Code sia con **GitHub Copilot** (modalità Agent) sia con **Cline**. Hanno elenchi MCP separati, quindi configuralo per quello che usi.

#### GitHub Copilot

Scegli **uno** di questi modi:

1. **Un clic** — [**Installa in VS Code**](https://insiders.vscode.dev/redirect/mcp/install?name=colibri&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3At4zxxx1%2Fcolibri-mcp%22%5D%7D) → si apre VS Code → **Install**.
2. **Da terminale** — aggiunge Colibri al tuo profilo utente, per tutti i progetti:

   ```bash
   # macOS / Linux
   code --add-mcp '{"name":"colibri","command":"npx","args":["-y","github:t4zxxx1/colibri-mcp"]}'
   ```
   ```powershell
   # Windows PowerShell
   code --add-mcp '{\"name\":\"colibri\",\"command\":\"npx\",\"args\":[\"-y\",\"github:t4zxxx1/colibri-mcp\"]}'
   ```
   ```bat
   :: Windows cmd
   code --add-mcp "{\"name\":\"colibri\",\"command\":\"npx\",\"args\":[\"-y\",\"github:t4zxxx1/colibri-mcp\"]}"
   ```
   Usi VS Code Insiders? Sostituisci `code` con `code-insiders`.
3. **Dal Command Palette** — `Ctrl+Shift+P` (`⌘⇧P` su Mac) → **MCP: Add Server** → **Command (stdio)** → incolla `npx -y github:t4zxxx1/colibri-mcp` → chiamalo `colibri` → **Global**.
4. **Solo per un progetto** — crea `.vscode/mcp.json` nella cartella del progetto:

   ```json
   {
     "servers": {
       "colibri": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "github:t4zxxx1/colibri-mcp"]
       }
     }
   }
   ```

Poi apri **Copilot Chat**, passa alla modalità **Agent**, clicca l'icona 🔧 **strumenti** e controlla che **colibri** (8 strumenti) sia spuntato. La prima volta VS Code ti chiede se ti fidi del server: rispondi di sì.

#### Cline

1. Apri il pannello di **Cline** → clicca l'icona **MCP Servers** → scheda **Installed** → **Configure MCP Servers**.
2. Si apre `cline_mcp_settings.json`: incolla questo (oppure aggiungi solo il blocco `"colibri"` accanto agli altri server) e salva:

   ```json
   {
     "mcpServers": {
       "colibri": {
         "command": "npx",
         "args": ["-y", "github:t4zxxx1/colibri-mcp"]
       }
     }
   }
   ```

3. Colibri compare nell'elenco con il pallino verde e i suoi 8 strumenti. Chiedi a Cline: *"Con Colibri apri example.com"*.

> **Su Windows:** se VS Code o Cline non trovano `npx`, usa `"command": "cmd"` e `"args": ["/c", "npx", "-y", "github:t4zxxx1/colibri-mcp"]`.

### Configurazione manuale

<details>
<summary><b>JSON <code>mcpServers</code></b> — Cursor, Windsurf, Cline, Roo, Gemini CLI, Claude Desktop…</summary>

`~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.gemini/settings.json`, `claude_desktop_config.json`…

```json
{
  "mcpServers": {
    "colibri": {
      "command": "npx",
      "args": ["-y", "github:t4zxxx1/colibri-mcp"],
      "env": { "CB_ALLOWED_DOMAINS": "" }
    }
  }
}
```
</details>

<details>
<summary><b>OpenAI Codex</b> — <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.colibri]
command = "npx"
args = ["-y", "github:t4zxxx1/colibri-mcp"]
```
</details>

<details>
<summary><b>Dal sorgente</b> — senza npx, avvio più rapido</summary>

```bash
git clone https://github.com/t4zxxx1/colibri-mcp
cd colibri-mcp && npm ci --omit=dev
# poi nel client:  node /percorso/colibri-mcp/extension/server/index.js
```
</details>

> **Su Windows:** se il client non trova `npx`, usa `"command": "cmd", "args": ["/c", "npx", "-y", "github:t4zxxx1/colibri-mcp"]`.

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Meglio di Jev — con i numeri veri

[Jev](https://jevai.net) ha reso famosa l'idea del **"Sistema Uno"**: rispondere a domande tipizzate con una confidenza calibrata e agire solo sopra una soglia. È ottimo — ed è un **modello cloud a pagamento**, con i suoi token e la sua chiave API.

Colibri porta **la stessa idea come motore locale** dentro il server MCP, specializzato nella decisione che un agente di navigazione prende di continuo: *in quale campo del modulo va questo dato?* Paghi solo l'abbonamento Claude/Copilot che hai già.

<div align="center">
<img src="docs/assets/jev-vs-local.svg" alt="Jev 1.14 contro il motore locale: accuratezza, calibrazione, AUROC, latenza, costo" width="100%"/>
</div>

| | Jev 1.14 ([System One Bench](https://systemonebench.dev)) | **Motore locale Colibri v0.4** |
|---|---|---|
| Accuratezza sulle scelte | 75,7% | **98,6%** (419 casi) · **87,9%** sul Test 5 indipendente |
| Errore di calibrazione (ECE) | 8,4% (scelta) · 6,0% complessivo | **5,9%** · **4,6%** sul Test 5 |
| AUROC della confidenza | 0,81 | **0,95** |
| Latenza | 136 ms p50 · 175 ms p95 | **1,7 ms p50 · 8,3 ms p95** (≈80× più veloce) |
| Costo | 0,028 $ ogni 1.000 chiamate + chiave API | **0, nessuna chiave, nessuna rete** |
| Azioni autonome sbagliate | — | **0** (precisione 100% quando agisce da solo) |
| Ambito | qualsiasi dominio (modello addestrato) | solo moduli web (euristiche + vocabolario) |

> **Nota onesta.** Gli insiemi di dati sono diversi: Jev 1.14 è misurato su 2.450 domande di scelta generiche, il motore locale su 419 casi di abbinamento campo-dato da pagine di prova scritte dall'autore (il Test 5 indipendente è stato scritto *dopo* le modifiche al motore e misurato una sola volta). Jev è generalista; questo motore fa un solo lavoro ed è ottimizzato per quello. È un ordine di grandezza, non una classifica. Metodo completo: [docs/calibrazione.md](docs/calibrazione.md).

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Benchmark

Stesse pagine, stessi compiti, otto metodi. Tutti hanno completato tutti i compiti. **"Contesto totale"** è la somma dei token che il modello rilegge in tutti i turni — ciò che determina davvero costo e lentezza.

<div align="center">
<img src="docs/assets/token-race.svg" alt="Token di contesto totali per il compito T1 con otto metodi" width="100%"/>
</div>

| Compito | Screenshot | Playwright MCP | agent-browser MCP | Fast Playwright MCP | **Colibri** |
|---|---|---|---|---|---|
| **T1** modulo di 22 campi, 2 pagine | 2.480.688 · 154 s | 318.910 · 52 s | 1.373.730 · 108 s | 115.624 · 57 s | **27.760 · 19 s** |
| **T2** elenco → tabella di dettaglio | 34.630 · 13 s | 73.333 · 15 s | 167.751 · 18 s | 37.480 · 12 s | **20.700 · 10 s** |
| **T3** navigazione da una home pesante | 23.809 · 10 s | 69.739 · 15 s | 148.169 · 17 s | 36.480 · 12 s | **12.849 · 8 s** |
| Lettura di una pagina di modulo | 1.366 (immagine) | 5.354 | 4.464 | 5.283 | **628** |
| Definizioni dei tool, a ogni turno | — | 4.536 | — | — | **1.347** |

Tabelle complete, ipotesi e limiti (le pagine di prova sono nate insieme a questo strumento, che quindi gioca in casa): [docs/benchmark.md](docs/benchmark.md).

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Come funziona

<div align="center">
<img src="docs/assets/pipeline.svg" alt="Agente → Colibri (righe, motore, controllo di sicurezza) → Chrome" width="100%"/>
</div>

1. **Pagina → righe.** Uno script dentro la pagina tiene solo ciò su cui si può agire: campi, menu, pulsanti, link, caselle — con nome, valore, stato (`req`, `inv`, `off`) e segnale di rischio. Intestazione, menu e piè di pagina vengono compressi; le righe di tabella ripetute vengono riassunte.
2. **Molti passi, una chiamata.** `browse_do` esegue fino a 40 passi (compila, scegli, spunta, clicca, aspetta, leggi) e prosegue anche dopo un cambio pagina, perché gli elementi si indicano per nome.
3. **Solo le differenze.** Dopo aver agito il modello riceve i campi verificati, gli elementi nuovi o cambiati, gli errori del modulo e il testo comparso (`»Domanda inviata, protocollo n. …`) — non di nuovo la pagina intera.
4. **Compiti guidati.** Con `browse_task` il modello non guarda nemmeno il modulo: passa i dati con le etichette dell'utente (`"P.IVA": "01234567890"`, `"data inizio": "03/11/2026"`) e il motore locale decide quale campo è quale, con una probabilità calibrata. Sopra la soglia agisce; sotto, chiede.

### Cosa vede il modello

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

Dopo 22 passi in **una** chiamata, la risposta completa è:

```
ok 22/22
---
16 campi impostati come richiesto · 5 altre variazioni
~ e31 "Codice ATECO" ="62 - Industrie alimentari (62)" req
~ e33 "Provincia" ="Napoli" req
~ e34 "Comune" ="Pozzuoli" req col
```

> Le descrizioni dei tool sono in inglese telegrafico per il modello (circa il 37% di token in meno); l'output delle pagine resta nella loro lingua. Funziona su qualsiasi sito e lingua — invio, consensi, password, carte e banner dei cookie sono riconosciuti in italiano, inglese, francese, spagnolo, tedesco e portoghese.

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Tool

| Tool | Cosa fa |
|---|---|
| `browse_open` | Apre un URL (avvia Chrome da solo), rifiuta i cookie non essenziali, restituisce le righe |
| `browse_search` | Ricerca web senza i CAPTCHA di Google: una riga per risultato `n. titolo \| url \| estratto`, link reali, niente annunci. Prima DuckDuckGo, Bing di riserva in automatico se compare una verifica |
| `browse_view` | Righe della pagina corrente, con `filter`, `scope:"all"` e paginazione |
| `browse_do` | Fino a 40 passi in ordine; restituisce solo le differenze |
| `browse_read` | Legge senza agire: `text`, `table`, `find`, `describe`, `cards` (una riga per risultato: `10:05 \| 13:40 \| 3h35 \| 1 cambio \| 29,90 €`), `pdf` (testo di un PDF scaricato o aperto, a pagine) |
| `browse_task` | Compito guidato in stile Jev: dati per etichetta, `answers`, `submit`, `expect`, `extract` tipizzato (testo, numero, importo, data, url, tabella). Le date divise in giorno / mese / anno (+ ore / minuti) si compilano da un solo valore: `"partenza": "12/06/2026 10:30"` |
| `browse_screenshot` | JPEG ridotto (~900 token) della finestra, di un elemento o di una regione — solo quando il testo non basta |
| `browse_stats` | Token usati nella sessione rispetto agli screenshot |

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Sicurezza

- **`!c` azioni con effetti** — invio, conferma, salvataggio, eliminazione, pagamento, accettazione di termini, caricamento: bloccate finché l'utente non dà l'ok, poi ripetute con `"confirm": true`. I pulsanti che aprono solo un menu (`aria-haspopup` / `aria-expanded`) e i contatori di quantità ("rimuovi passeggero") non vengono bloccati.
- **`!x` dati riservati** — password, numeri di carta, CVV, OTP, IBAN: l'AI non può mai scriverli, nemmeno con conferma. Li inserisci tu nella finestra.
- **Compiti guidati**: il motore agisce da solo solo sopra la soglia di confidenza; l'invio non parte con domande aperte, errori o campi obbligatori vuoti.
- **Domini consentiti**, niente `file://` / `javascript:`, testo delle pagine trattato come dato non fidato (resistente alla prompt injection), riferimenti unici per sessione.

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Impostazioni

| Variabile | Default | |
|---|---|---|
| `CB_ALLOWED_DOMAINS` | tutti | elenco separato da virgole |
| `CB_CONFIRM_SENSITIVE` | `true` | consigliato lasciarla attiva |
| `CB_HEADLESS` | `false` | browser invisibile |
| `CB_PROFILE_DIR` | `~/.colibri/profile` | qui restano accessi e cookie |
| `CB_DOWNLOADS_DIR` | `~/Downloads` | |
| `CB_CHROME_PATH` | automatico | solo se Chrome/Edge non viene trovato |
| `CB_ALLOW_SCREENSHOT` | `true` | |
| `CB_HUMAN_WAIT` | `50` | secondi di attesa mentre risolvi un CAPTCHA / una verifica (`0` = non aspettare) |
| `CB_HUMAN_SHOW` | `true` | se il browser è invisibile e la verifica non si supera da sola, riapre Chrome visibile sulla stessa pagina |
| `CB_MODE` / `CB_CDP_URL` | `launch` | `cdp` = **modalità Chrome reale**: si collega a un Chrome normale su `--remote-debugging-port=9222` (vedi FAQ) |
| `CB_AUTO_CHROME` | `true` | in modalità `cdp`, avvia da solo il Chrome reale se sulla porta non risponde nessuno |
| `CB_REAL_PROFILE_DIR` | `~/.colibri/real-chrome` | profilo del Chrome reale avviato da Colibri |
| `CB_SEARCH_URL` | DuckDuckGo, poi Bing | pagina/e di ricerca per `browse_search`, `{q}` = testo cercato; più indirizzi separati da spazi vengono provati in ordine |

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Limiti

- Grafici, canvas e mappe non hanno testo: l'agente usa lo screenshot ridotto (con i riferimenti disegnati sopra) e il clic a coordinate relative.
- Il motore di `browse_task` è un vocabolario calibrato, non un modello addestrato: con termini di settore che non conosce chiede più spesso (senza mai agire in modo sbagliato). Le risposte vengono ricordate per sito.
- CAPTCHA e accessi li fai tu, nella finestra: Colibri non li aggira mai, si mette in pausa e riprende da solo (vedi FAQ).
- Testato su pagine costruite sul modello dei portali della pubblica amministrazione: segnala nelle [Issues](https://github.com/t4zxxx1/colibri-mcp/issues) i siti che non funzionano.

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Domande frequenti

<details>
<summary><b>Serve un account Jev, una chiave API o un piano a pagamento?</b></summary>

No. Il motore in stile Jev gira in locale dentro Colibri. Usi solo l'agente che hai già (Claude, Copilot, Codex, Gemini…).
</details>

<details>
<summary><b>Quale browser usa? Vede i miei accessi?</b></summary>

Chrome o Edge, con un profilo dedicato in `~/.colibri/profile`: fai l'accesso una volta e se lo ricorda. Per usare **il tuo** Chrome già aperto, avvialo con `--remote-debugging-port=9222` e imposta `CB_MODE=cdp`.
</details>

<details>
<summary><b>Come aggiorno o blocco una versione?</b></summary>

`github:t4zxxx1/colibri-mcp` segue l'ultimo `main`. Per fissare una release usa `github:t4zxxx1/colibri-mcp#v0.4.0`. Su Claude Desktop scarica il nuovo `.mcpb` dalle [Release](https://github.com/t4zxxx1/colibri-mcp/releases).
</details>

<details>
<summary><b>Funziona invisibile, su un server o in CI?</b></summary>

Sì: `CB_HEADLESS=true`. Accessi e CAPTCHA la prima volta richiedono comunque una finestra visibile.
</details>

<details>
<summary><b>Cosa succede quando un sito chiede un CAPTCHA o "verifica di essere umano"?</b></summary>

Colibri riconosce la verifica (Cloudflare "Just a moment" / Turnstile, reCAPTCHA, hCaptcha, DataDome, PerimeterX "tieni premuto", AWS WAF, Arkose, GeeTest, Friendly Captcha, captcha a immagine) e **non prova ad aggirarla**. Invece:

1. aspetta qualche secondo: molte verifiche (es. Cloudflare) si superano da sole;
2. altrimenti mostra una barra in cima alla pagina, *"🐦 Colibri è in pausa: completa la verifica qui sotto"*, e porta la finestra in primo piano (se era invisibile riapre Chrome visibile sulla stessa pagina);
3. riprende **da solo** appena l'hai risolta e prosegue con i passi rimanenti;
4. con un CAPTCHA dentro un modulo compila tutto il resto e aspetta te prima di premere *Invia*.

Se non la risolvi entro `CB_HUMAN_WAIT` secondi (default 50) l'agente viene avvisato di chiedertelo, e `browse_view` riprende ad aspettare. Per i siti con protezioni anti-bot molto severe conviene la **modalità Chrome reale** (domanda seguente).
</details>

<details>
<summary><b>La verifica Cloudflare va in loop. Cos'è la "modalità Chrome reale"?</b></summary>

Di default Colibri avvia Chrome tramite Playwright, che lo marca come automatizzato: alcuni siti ripetono all'infinito "verifica di essere umano". In modalità Chrome reale Colibri usa invece un **Chrome normale**. Nessun trucco per nascondere l'automazione: è semplicemente un browser normale.

1. Aggiungi `"env": { "CB_MODE": "cdp" }` alla voce di Colibri nella configurazione MCP del tuo agente.
2. Fatto: alla prima chiamata Colibri avvia un Chrome normale sulla porta 9222 (profilo in `~/.colibri/real-chrome`). Per avviarlo tu: `npx -y github:t4zxxx1/colibri-mcp --chrome`.

In questa modalità Colibri **non chiude mai il tuo Chrome**: alla riconnessione (`/mcp`) chiude solo le schede aperte da lui. Quando una verifica blocca in modalità normale, è Colibri stesso a suggerirti di passare a questa modalità.
</details>

<details>
<summary><b>L'AI può pagare, inviare o scrivere la mia password per errore?</b></summary>

No. Le azioni con effetti (`!c`) richiedono il tuo ok esplicito, i dati segreti (`!x`) non possono mai essere scritti dall'AI. Vedi [Sicurezza](#sicurezza).
</details>

<div align="right"><a href="#top">↑ torna su</a></div>

---

## Per sviluppatori

<details>
<summary><b>Build, test, benchmark, release</b></summary>

```bash
npm ci            # dipendenze di sviluppo e di esecuzione
npm test          # oltre 180 test end-to-end via protocollo MCP (serve Chrome o Edge)
npm run test:live # prove facoltative su siti reali: ricerca, PDF, modulo httpbin, Wikipedia (serve la rete)
npm run bench     # confronto con screenshot, Playwright MCP, agent-browser, Fast Playwright MCP
npm run calibrate # calibrazione del motore (VERIFY5=1 aggiunge il Test 5 indipendente)
npm run build     # dist/colibri.mcpb
```

Documentazione: [come funziona](docs/come-funziona.md) · [benchmark](docs/benchmark.md) · [calibrazione e confronto con Jev](docs/calibrazione.md).
Nuova versione: aggiorna `version` in `package.json`, `extension/manifest.json`, `extension/server/package.json`, poi `git tag vX.Y.Z && git push --tags` — la CI esegue i test, crea il `.mcpb` e lo pubblica.
</details>

---

## Sostieni il progetto

Se ti fa risparmiare token, **⭐ lascia una stella** — è il modo migliore per farlo conoscere. Idee, bug e siti da supportare: [apri una issue](https://github.com/t4zxxx1/colibri-mcp/issues). Fatto con cura in Italia da **[@t4zxxx1](https://github.com/t4zxxx1)** · Roca Software.

## Licenza

MIT — vedi [LICENSE](LICENSE). © 2026 Roca Software.
