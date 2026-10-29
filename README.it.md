<div align="center">

<img src="docs/assets/hero.svg" alt="compact-browser-mcp — la tua AI guida Chrome leggendo testo, non screenshot" width="100%"/>

<h3>Il browser a basso consumo di token per agenti AI.<br/>Stessi compiti. <b>89× meno token</b> degli screenshot, <b>11× meno</b> di Playwright MCP.</h3>

<p>
<a href="https://github.com/t4zxxx1/compact-browser-mcp/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/t4zxxx1/compact-browser-mcp?style=for-the-badge&color=22d3ee&labelColor=0d1117"/></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/licenza-MIT-a78bfa?style=for-the-badge&labelColor=0d1117"/></a>
<a href="https://modelcontextprotocol.io"><img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-34d399?style=for-the-badge&labelColor=0d1117"/></a>
<img alt="Token Jev" src="https://img.shields.io/badge/token%20Jev-0-f59e0b?style=for-the-badge&labelColor=0d1117"/>
<a href="https://github.com/t4zxxx1/compact-browser-mcp/stargazers"><img alt="Stelle" src="https://img.shields.io/github/stars/t4zxxx1/compact-browser-mcp?style=for-the-badge&color=f472b6&labelColor=0d1117"/></a>
</p>

<p>
<a href="https://insiders.vscode.dev/redirect/mcp/install?name=compact-browser&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3At4zxxx1%2Fcompact-browser-mcp%22%5D%7D"><img alt="Installa in VS Code" src="https://img.shields.io/badge/VS_Code-Installa-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white"/></a>
<a href="https://cursor.com/en/install-mcp?name=compact-browser&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdpdGh1Yjp0NHp4eHgxL2NvbXBhY3QtYnJvd3Nlci1tY3AiXX0="><img alt="Installa in Cursor" src="https://img.shields.io/badge/Cursor-Installa-000000?style=flat-square&logo=cursor&logoColor=white"/></a>
<a href="https://github.com/t4zxxx1/compact-browser-mcp/releases/latest/download/compact-browser.mcpb"><img alt="Claude Desktop" src="https://img.shields.io/badge/Claude_Desktop-.mcpb-D97757?style=flat-square&logo=anthropic&logoColor=white"/></a>
</p>

[English](README.md) · **Italiano**

</div>

---

## Perché

Gli agenti AI navigano nel modo più costoso possibile: **uno screenshot costa ~1.366 token**, un albero di accessibilità **4.400–7.700 token a pagina**, e ogni chiamata in più costringe il modello a **rileggere tutta la conversazione**.

**compact-browser-mcp** trasforma ogni pagina in poche centinaia di token di righe di testo — campi, valori, stato, segnali di rischio — esegue **molti passi in una sola chiamata**, risponde **solo con ciò che è cambiato** e compila i moduli con un **motore locale in stile Jev** che non richiede chiavi API e costa **zero token**.

- ⚡ **27.760 token** per una domanda di 22 campi su due pagine — contro 318.910 con Playwright MCP e 2,48 milioni con gli screenshot
- 🧠 **Decisioni tipizzate in stile Jev, in locale**: accuratezza 98,6%, AUROC 0,95, **1,7 ms** per abbinamento, **0 €**
- 🔌 **Qualsiasi client MCP**: Claude Desktop e Code, GitHub Copilot (VS Code), Cursor, Windsurf, Codex, Gemini CLI…
- 🛡️ **Sicuro per default**: invio/pagamento/eliminazione chiedono il tuo ok (`!c`), password/carte/OTP non vengono mai scritti dall'AI (`!x`)
- 🏠 **100% locale**: il tuo profilo Chrome, i tuoi accessi, nessun dato passa da server di terzi

<div align="center">
<img src="docs/assets/terminal.svg" alt="Demo di browse_task: 21 etichette dell'utente abbinate a 21 campi senza leggere la pagina" width="100%"/>
</div>

## Installazione in 30 secondi

Servono **Node.js ≥ 18** e **Google Chrome o Microsoft Edge**. Il server si avvia con:

```bash
npx -y github:t4zxxx1/compact-browser-mcp
```

<details open>
<summary><b>Claude Desktop</b> — un clic</summary>

Scarica **[compact-browser.mcpb](https://github.com/t4zxxx1/compact-browser-mcp/releases/latest/download/compact-browser.mcpb)** e aprilo con doppio clic. Le impostazioni (domini consentiti, browser invisibile, cartella del profilo…) sono in *Impostazioni → Estensioni*.

</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add compact-browser -- npx -y github:t4zxxx1/compact-browser-mcp
```
</details>

<details>
<summary><b>GitHub Copilot in VS Code</b></summary>

Clicca il badge **Installa in VS Code** qui sopra, oppure aggiungi a `.vscode/mcp.json`:

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
<summary><b>Cursor · Windsurf · Gemini CLI · Cline · qualsiasi client con <code>mcpServers</code></b></summary>

`~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.gemini/settings.json`, `claude_desktop_config.json` di Claude Desktop…

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
<summary><b>Dal sorgente</b> (senza npx, avvio più rapido)</summary>

```bash
git clone https://github.com/t4zxxx1/compact-browser-mcp
cd compact-browser-mcp && npm ci --omit=dev
# poi nel client:  node /percorso/compact-browser-mcp/extension/server/index.js
```
</details>

> **Su Windows:** se il client non trova `npx`, usa `"command": "cmd", "args": ["/c", "npx", "-y", "github:t4zxxx1/compact-browser-mcp"]`.

Poi basta chiedere: *"Apri il portale fornitori e compila la domanda con questi dati: …"* — oppure *"Con il browser compatto leggimi le edizioni del progetto PF-2026-115"*.

## Meglio di Jev — con i numeri veri

[Jev](https://jevai.net) ha reso famosa l'idea del **"Sistema Uno"**: rispondere a domande tipizzate con una confidenza calibrata e agire solo sopra una soglia. È ottimo — ed è un **modello cloud a pagamento**, con i suoi token e la sua chiave API.

compact-browser-mcp porta **la stessa idea come motore locale** dentro il server MCP, specializzato nella decisione che un agente di navigazione prende di continuo: *in quale campo del modulo va questo dato?* Paghi solo l'abbonamento Claude/Copilot che hai già.

<div align="center">
<img src="docs/assets/jev-vs-local.svg" alt="Jev 1.14 contro il motore locale: accuratezza, calibrazione, AUROC, latenza, costo" width="100%"/>
</div>

| | Jev 1.14 ([System One Bench](https://systemonebench.dev)) | **Motore locale compact-browser v0.4** |
|---|---|---|
| Accuratezza sulle scelte | 75,7% | **98,6%** (419 casi) · **87,9%** sul Test 5 indipendente |
| Errore di calibrazione (ECE) | 8,4% (scelta) · 6,0% complessivo | **5,9%** · **4,6%** sul Test 5 |
| AUROC della confidenza | 0,81 | **0,95** |
| Latenza | 136 ms p50 · 175 ms p95 | **1,7 ms p50 · 8,3 ms p95** (≈80× più veloce) |
| Costo | 0,028 $ ogni 1.000 chiamate + chiave API | **0, nessuna chiave, nessuna rete** |
| Azioni autonome sbagliate | — | **0** (precisione 100% quando agisce da solo) |
| Ambito | qualsiasi dominio (modello addestrato) | solo moduli web (euristiche + vocabolario) |

> **Nota onesta.** Gli insiemi di dati sono diversi: Jev 1.14 è misurato su 2.450 domande di scelta generiche, il motore locale su 419 casi di abbinamento campo-dato da pagine di prova scritte dall'autore (il Test 5 indipendente è stato scritto *dopo* le modifiche al motore e misurato una sola volta). Jev è generalista; questo motore fa un solo lavoro ed è ottimizzato per quello. È un ordine di grandezza, non una classifica. Metodo completo: [docs/calibrazione.md](docs/calibrazione.md).

## Benchmark

Stesse pagine, stessi compiti, otto metodi. Tutti hanno completato tutti i compiti. **"Contesto totale"** è la somma dei token che il modello rilegge in tutti i turni — ciò che determina davvero costo e lentezza.

<div align="center">
<img src="docs/assets/token-race.svg" alt="Token di contesto totali per il compito T1 con otto metodi" width="100%"/>
</div>

| Compito | Screenshot | Playwright MCP | agent-browser MCP | Fast Playwright MCP | **compact-browser** |
|---|---|---|---|---|---|
| **T1** modulo di 22 campi, 2 pagine | 2.480.688 · 154 s | 318.910 · 52 s | 1.373.730 · 108 s | 115.624 · 57 s | **27.760 · 19 s** |
| **T2** elenco → tabella di dettaglio | 34.630 · 13 s | 73.333 · 15 s | 167.751 · 18 s | 37.480 · 12 s | **20.700 · 10 s** |
| **T3** navigazione da una home pesante | 23.809 · 10 s | 69.739 · 15 s | 148.169 · 17 s | 36.480 · 12 s | **12.849 · 8 s** |
| Lettura di una pagina di modulo | 1.366 (immagine) | 5.354 | 4.464 | 5.283 | **628** |
| Definizioni dei tool, a ogni turno | — | 4.536 | — | — | **1.347** |

Tabelle complete, ipotesi e limiti (le pagine di prova sono nate insieme a questo strumento, che quindi gioca in casa): [docs/benchmark.md](docs/benchmark.md).

## Come funziona

<div align="center">
<img src="docs/assets/pipeline.svg" alt="Agente → compact-browser-mcp (righe, motore, controllo di sicurezza) → Chrome" width="100%"/>
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

## Tool

| Tool | Cosa fa |
|---|---|
| `browse_open` | Apre un URL (avvia Chrome da solo), rifiuta i cookie non essenziali, restituisce le righe |
| `browse_view` | Righe della pagina corrente, con `filter`, `scope:"all"` e paginazione |
| `browse_do` | Fino a 40 passi in ordine; restituisce solo le differenze |
| `browse_read` | Legge senza agire: `text`, `table`, `find`, `describe` |
| `browse_task` | Compito guidato in stile Jev: dati per etichetta, `answers`, `submit`, `expect`, `extract` tipizzato (testo, numero, importo, data, url, tabella) |
| `browse_screenshot` | JPEG ridotto (~900 token) della finestra, di un elemento o di una regione — solo quando il testo non basta |
| `browse_stats` | Token usati nella sessione rispetto agli screenshot |

## Sicurezza

- **`!c` azioni con effetti** — invio, conferma, salvataggio, eliminazione, pagamento, accettazione di termini, caricamento: bloccate finché l'utente non dà l'ok, poi ripetute con `"confirm": true`.
- **`!x` dati riservati** — password, numeri di carta, CVV, OTP, IBAN: l'AI non può mai scriverli, nemmeno con conferma. Li inserisci tu nella finestra.
- **Compiti guidati**: il motore agisce da solo solo sopra la soglia di confidenza; l'invio non parte con domande aperte, errori o campi obbligatori vuoti.
- **Domini consentiti**, niente `file://` / `javascript:`, testo delle pagine trattato come dato non fidato (resistente alla prompt injection), riferimenti unici per sessione.

## Impostazioni

| Variabile | Default | |
|---|---|---|
| `CB_ALLOWED_DOMAINS` | tutti | elenco separato da virgole |
| `CB_CONFIRM_SENSITIVE` | `true` | consigliato lasciarla attiva |
| `CB_HEADLESS` | `false` | browser invisibile |
| `CB_PROFILE_DIR` | `~/.compact-browser/profile` | qui restano accessi e cookie |
| `CB_DOWNLOADS_DIR` | `~/Downloads` | |
| `CB_CHROME_PATH` | automatico | solo se Chrome/Edge non viene trovato |
| `CB_ALLOW_SCREENSHOT` | `true` | |
| `CB_MODE` / `CB_CDP_URL` | `launch` | `cdp` si collega al **tuo Chrome già aperto** con `--remote-debugging-port=9222` |

## Limiti

- Grafici, canvas e mappe non hanno testo: l'agente usa lo screenshot ridotto (con i riferimenti disegnati sopra) e il clic a coordinate relative.
- Il motore di `browse_task` è un vocabolario calibrato, non un modello addestrato: con termini di settore che non conosce chiede più spesso (senza mai agire in modo sbagliato). Le risposte vengono ricordate per sito.
- CAPTCHA e accessi li fai tu, nella finestra.
- Testato su pagine costruite sul modello dei portali della pubblica amministrazione: segnala nelle [Issues](https://github.com/t4zxxx1/compact-browser-mcp/issues) i siti che non funzionano.

## Per sviluppatori

```bash
npm ci            # dipendenze di sviluppo e di esecuzione
npm test          # oltre 120 test end-to-end via protocollo MCP (serve Chrome o Edge)
npm run bench     # confronto con screenshot, Playwright MCP, agent-browser, Fast Playwright MCP
npm run calibrate # calibrazione del motore (VERIFY5=1 aggiunge il Test 5 indipendente)
npm run build     # dist/compact-browser.mcpb
```

Documentazione: [come funziona](docs/come-funziona.md) · [benchmark](docs/benchmark.md) · [calibrazione e confronto con Jev](docs/calibrazione.md).
Nuova versione: aggiorna `version` in `package.json`, `extension/manifest.json`, `extension/server/package.json`, poi `git tag vX.Y.Z && git push --tags` — la CI esegue i test, crea il `.mcpb` e lo pubblica.

## Sostieni il progetto

Se ti fa risparmiare token, **⭐ lascia una stella** — è il modo migliore per farlo conoscere. Idee, bug e siti da supportare: [apri una issue](https://github.com/t4zxxx1/compact-browser-mcp/issues). Fatto con cura in Italia da **[@t4zxxx1](https://github.com/t4zxxx1)** · Roca Software.

## Licenza

MIT — vedi [LICENSE](LICENSE). © 2026 Roca Software.
