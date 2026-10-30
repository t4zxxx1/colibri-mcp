# Changelog

## 0.5.4

**English**
- **Upload behind "drag here" areas**: a `<input type=file>` hidden inside a drop zone (`display:none`, no visible label) now gets a ref named after the visible area, for example `e12 file "Upload an image Click or drag and drop…"`. It was invisible to Colibri before (seen on IMGto3D.ai). `upload` aimed at the area itself tries, in order: the file input inside it, the file chooser opened by clicking it, then a file input right next to it. The note says which one was used. Upload still needs `"confirm": true`.
- **Clickable areas with no label**: `browse_view` with `scope:"areas"` finds elements that act like buttons but have no role or name: pointer-cursor blocks, icons, canvases and drop zones. Each gets a ref (`area "~cube.png 48x48 @0.12,0.40"` = image, size and centre 0-1 when there is no text). They stay available to `click`, `hover` and `upload` in later views. The scan only runs on request, so normal views cost nothing extra. Before this, the only option was a screenshot.
- `npm run test:live` also checks a real upload area (no file is sent).

**Italiano**
- **Upload dietro le aree "trascina qui"**: un `<input type=file>` nascosto dentro una drop-zone (`display:none`, senza etichetta visibile) ora riceve un ref col nome dell'area visibile, per esempio `e12 file "Carica un'immagine Fai clic per caricare o trascina…"`. Prima Colibri non lo vedeva (successo su IMGto3D.ai). Un `upload` sull'area stessa prova, in ordine: l'input file al suo interno, la finestra di scelta file aperta dal clic, poi un input file subito accanto. La nota dice quale è stato usato. L'upload richiede sempre `"confirm": true`.
- **Aree cliccabili senza etichetta**: `browse_view` con `scope:"areas"` trova gli elementi che si comportano da pulsanti ma non hanno ruolo né nome: blocchi col cursore a mano, icone, canvas e zone di trascinamento. Ognuno riceve un ref (`area "~cube.png 48x48 @0.12,0.40"` = immagine, misura e centro 0-1 quando non c'è testo). Restano utilizzabili da `click`, `hover` e `upload` nelle viste successive. La scansione parte solo su richiesta, quindi le viste normali non costano niente in più. Prima l'unica strada era uno screenshot.
- `npm run test:live` controlla anche un'area di caricamento reale (nessun file viene inviato).

## 0.5.3

**English**
- **`browse_search`**: web search without Google's CAPTCHAs. Returns one row per result (`n. title | url | snippet`) with real links (DuckDuckGo and Bing redirects unwrapped), and no ads or duplicates. About 440 characters for 3 results. DuckDuckGo comes first; if it asks for a check (it often does with a headless Chrome), Colibri moves to Bing by itself instead of stopping. A check on the last engine pauses for the user as usual and is never bypassed. `CB_SEARCH_URL` sets custom engines, and `CB_ALLOWED_DOMAINS` is respected.
- **Dates split across several fields** in `browse_task`. Day / month / year selects or inputs, with optional hour / minutes, are recognised as one date field from their name, `name`/`id`, placeholder, options, legend or group label. One value fills them all: `"departure": "12/06/2026 10:30"`. Months can be numbers or names (it/en/de/fr/es, abbreviations included). Minutes offered in steps snap to the nearest option and Colibri reports it. A missing year is a clear error, never a random choice. A nearby "Hours of training" field is not mistaken for the hour.
- The DuckDuckGo "bots use DuckDuckGo too" check is now detected as a human check.
- **Tests on real sites**: `npm run test:live` (opt-in, needs network) covers a real search, example.com, a public PDF, a real form submitted on httpbin, and Wikipedia without false blocks.
- In `cdp` mode, Colibri checks the port again before starting its own Chrome, so a user Chrome that is still starting is not missed.

**Italiano**
- **`browse_search`**: ricerca web senza i CAPTCHA di Google. Restituisce una riga per risultato (`n. titolo | url | estratto`) con link reali (reindirizzamenti di DuckDuckGo e Bing sciolti), senza annunci né duplicati. Circa 440 caratteri per 3 risultati. Prima prova DuckDuckGo; se chiede una verifica (capita spesso con Chrome invisibile), Colibri passa a Bing da solo invece di fermarsi. Una verifica sull'ultimo motore mette in pausa per l'utente come sempre e non viene mai aggirata. `CB_SEARCH_URL` imposta motori personalizzati e `CB_ALLOWED_DOMAINS` viene rispettato.
- **Date divise in più campi** in `browse_task`. Menu o campi giorno / mese / anno, con ore e minuti facoltativi, vengono riconosciuti come un'unica data da nome, `name`/`id`, placeholder, opzioni, legenda o etichetta del gruppo. Un solo valore li compila tutti: `"partenza": "12/06/2026 10:30"`. I mesi possono essere numeri o nomi (it/en/de/fr/es, anche abbreviati). I minuti a passi prendono l'opzione più vicina e Colibri lo segnala. Un anno assente dal menu dà un errore chiaro, mai una scelta a caso. Un campo vicino come "Ore di formazione" non viene scambiato per l'ora.
- La verifica di DuckDuckGo ("bots use DuckDuckGo too") ora viene riconosciuta come verifica umana.
- **Test su siti reali**: `npm run test:live` (facoltativo, serve la rete) prova una ricerca vera, example.com, un PDF pubblico, un modulo vero inviato su httpbin e Wikipedia senza falsi blocchi.
- In modalità `cdp` Colibri ricontrolla la porta prima di avviare un Chrome suo, così un Chrome dell'utente ancora in avvio non viene ignorato.

## 0.5.2

**English**
- **Real Chrome mode, guided.** With `CB_MODE=cdp`, Colibri starts a normal Chrome on port 9222 by itself if none is running (`CB_AUTO_CHROME`, profile `~/.colibri/real-chrome`). One-shot command: `npx -y github:t4zxxx1/colibri-mcp --chrome`. When a check blocks in launch mode, Colibri suggests real Chrome mode.
- **Your Chrome is never closed.** In `cdp` mode, a reconnect (`/mcp`) closes only the tabs Colibri opened. It reuses an existing blank tab instead of leaving an extra `about:blank`. The auto-started Chrome is detached from the agent's process tree.
- **More precise block detection.** If the Cloudflare clearance cookie (`cf_clearance`) is present and the page shows real content, Colibri does not pause again. A "Just a moment" title alone on a full page is no longer treated as a wall.
- **Fewer useless confirmations.** `!c` no longer blocks buttons that only open a menu (`aria-haspopup`, `aria-expanded`) or quantity steppers such as "remove passenger".
- **Stale refs recovered in `browse_do`.** If an element is redrawn (e.g. inside a dialog, e554 → e611), the step finds it again by role and name.
- **`read: "cards"`**: result lists as one compact row per card (`10:05 | 13:40 | 3h35 | 1 change | €29.90`).
- **`read: "pdf"`**: text of a downloaded or open PDF, paged, with no external tools. Downloads that start from `browse_open` no longer fail.
- **Smarter waiting.** `wait: "idle"` and the settle logic wait for spinners, skeletons and `aria-busy` instead of fixed delays.
- `extension/server/package-lock.json` aligned. Release notes now include this changelog.

**Italiano**
- **Modalità Chrome reale guidata.** Con `CB_MODE=cdp` Colibri avvia da solo un Chrome normale sulla porta 9222 se non ce n'è uno attivo (`CB_AUTO_CHROME`, profilo `~/.colibri/real-chrome`). Comando unico: `npx -y github:t4zxxx1/colibri-mcp --chrome`. Quando una verifica blocca in modalità normale, Colibri suggerisce la modalità Chrome reale.
- **Il tuo Chrome non viene mai chiuso.** In modalità `cdp` una riconnessione (`/mcp`) chiude solo le schede aperte da Colibri. Riusa una scheda vuota esistente invece di lasciare un `about:blank` in più. Il Chrome avviato in automatico è separato dall'albero dei processi dell'agente.
- **Rilevamento dei blocchi più preciso.** Se c'è il cookie di superamento Cloudflare (`cf_clearance`) e la pagina mostra contenuto vero, Colibri non si rimette in pausa. Un titolo "Just a moment" su una pagina piena non è più considerato un blocco.
- **Meno conferme inutili.** `!c` non blocca più i pulsanti che aprono solo un menu (`aria-haspopup`, `aria-expanded`) né i contatori come "rimuovi passeggero".
- **Riferimenti scaduti recuperati anche in `browse_do`.** Se un elemento viene ridisegnato (ad esempio dentro una finestra, e554 → e611), il passo lo ritrova per ruolo e nome.
- **`read: "cards"`**: liste di risultati come una riga compatta per scheda (`10:05 | 13:40 | 3h35 | 1 cambio | 29,90 €`).
- **`read: "pdf"`**: testo di un PDF scaricato o aperto, a pagine, senza strumenti esterni. I download avviati da `browse_open` non danno più errore.
- **Attesa più intelligente.** `wait: "idle"` e la logica di assestamento aspettano spinner, skeleton e `aria-busy` invece di attese fisse.
- `extension/server/package-lock.json` allineato. Le note di rilascio ora includono questo changelog.
