# Changelog

## 0.5.12

**Work in your own Chrome, in the tab you are looking at.** No new window, no new tab, no new logins.

- New `CB_MODE=attach`: Colibri finds the Chrome you already have open (the `DevToolsActivePort` file that Chrome writes when remote debugging is enabled at `chrome://inspect/#remote-debugging`, Chrome 144+) and connects to it. It never launches a browser. Profiles searched: Chrome, Beta, Canary, Edge, Brave, Chromium on Windows, macOS and Linux, or the folder in `CB_USER_DATA_DIR`. Chrome asks you to allow the connection: the wait for your click does not count against the tool time limits. Without a reachable Chrome the error explains the setup in one line.
- New `CB_TAB=active|new` (default `active` in `attach` and `cdp` modes): Colibri works in the tab you are looking at (focused window, then visible tab, then the most recently used one according to Chrome) instead of opening its own. The page is not reloaded; the change observer used for waits and diffs is added on the fly.
- New step `{"tab":"active"}`: follows you when you switch tab. If you close the tab Colibri is working in, it moves to the one you have in front of you.
- Your Chrome and your tabs are never closed: on exit Colibri closes only the tabs it opened itself.
- `npx -y github:t4zxxx1/colibri-mcp --attach` checks whether your Chrome is ready for the connection.
- Claude Desktop extension: new setting "Quale Chrome usare" (`launch` / `attach` / `cdp`).
- `browse_view` now also shows pending notices (connection, downloads, new tabs).

**Also in this release** (PR #1): local **code mode** — `browse_do {script}` runs a small JS script in a sandbox (node:vm in a worker: no host objects, hard timeout, call cap, result cap) and `CB_CODE_MODE=true` exposes a single `browse_code` tool (about 377 tokens of definitions instead of about 1,800); trigram similarity and section-aware matching in `browse_task` (also Shadow DOM); card titles for generic links; local `filter` for `browse_read` text/table (−58% tokens on real sites); a network-quiet window after actions for SPAs.

**Also in this release**: fixes from a real session driving phpMyAdmin (code editor, tables, script API).

**Code editors (CodeMirror, Monaco, Ace)**
- `fill` on an editor whose real input is a 1px textarea covered by the rendered text no longer times out: the element is focused by script and the text is inserted from the keyboard. The step says `editor coperto: testo inserito da tastiera, non verificabile dal campo` instead of a false `il campo non l'ha accettato` (editors keep the text in their own model and clear the textarea).
- `type` falls back to focusing the element when the click is blocked by an overlay. `click` with `force:true` now focuses the element too.
- `type` without a ref: `{"type":"focus","text":…}` writes into the element that already has focus, and `{"type":{"x":0.4,"y":0.3},"text":…}` clicks that point first. Password fields are refused.

**Safer writes**
- `fill`/`type` by name no longer pick a field "by similarity" below 97% confidence (before, `sql_query` filled the bookmark label "Aggiungi ai preferiti questa query SQL" at 71%). They now fail and list the closest candidates. Clicks keep the old behaviour.

**Tables and scripts**
- `read:"table"` without a target picks the visible table with the most rows instead of the first `<table>` of the DOM (often a hidden settings panel).
- Script docs: `colibri.text()` and `colibri.tables()` (there are no bare `text()`/`tables()` globals).

Tests: new `test/attach.mjs` (12 checks: attach via `DevToolsActivePort`, logins kept, no new tab, `tab:"active"`, user tabs survive, clear error without Chrome, `cdp` with the active tab, `CB_TAB=new`, `--attach`) and `test/v0512.mjs` (editors, safer writes), all previous suites green.

**IT** — Colibri lavora nel tuo Chrome già aperto e nella scheda che stai guardando, con i tuoi accessi: `CB_MODE=attach` (attiva una volta il debug remoto in `chrome://inspect/#remote-debugging` e clicca *Consenti*), `CB_TAB=active|new`, passo `tab:"active"` per seguire la scheda in cui passi, diagnostica `--attach`. Non chiude mai il tuo Chrome né le tue schede. Inoltre: modalità script locale (`CB_CODE_MODE`), editor di codice (CodeMirror) e scrittura più sicura (fill/type non scelgono più un campo "per somiglianza" sotto il 97%), read:"table" sceglie la tabella visibile con più righe.

## 0.5.11

Fixes from an analysis of 221 real calls on 0.5.10 (ministry portal, Fondimpresa, online shops).

**Filters and page alerts**
- `filter` with `|` now means "any of these" (`"percors|piano|ID"`) in `browse_view`, `browse_open` and cards (per word). Before, it was a literal substring and always returned nothing, which pushed the model to screenshots. When no interactive item matches, the matching lines of the page text are shown (data in Angular tables lives in cells).
- Page alerts: Struts/JSP classes (`errorMessage`, `actionError(s)`, `actionMessage(s)`, `fieldError`…) and texts starting with "Attenzione!/Errore:" are reported. `role=status` / `aria-live=polite` regions are kept only when they hold an outcome (error, saved, added…), so shop prices ("From €34,00"), counters ("Confronta 2 prodotti") and lone asterisks no longer appear as alerts.

**Actions that tell the truth**
- `fill`: after typing, the field is blurred so the site's validation runs, and the value is read back. If the site cleared or changed it, the step says `⚠ … il campo non l'ha accettato` with the text of any alert (`il sito ha risposto "usa il PUNTO…"`), and the header shows `⚠ 1 valore non accettato` instead of a plain "ok".
- `click` timeout: if the page changed anyway, the click counts as done ("clic lento ma riuscito"). Otherwise the error names what covers the element (`coperto da modale "Filtri": chiudilo … oppure "force": true`), also for fixed veils without classes, or says that it is not visible.

**Tabs and popups**
- New tabs become active only when a click/press/pick of the current step opened them from the active page. Tabs opened by ads during a `goto` stay in the background (`1 scheda aperta dalla pagina in sfondo`); blank or ad tabs that Colibri owns are closed.
- Promotional popups (newsletter, welcome discount, "personalised experience") are closed with their own Close/×/No thanks button when a page is opened, after a `goto`, and when a view finds them. Never windows with login, payment, confirmations, verification or more than one field. Disable with `CB_CLOSE_POPUPS=false`.

**Step aliases** (forms models often use, no longer rejected)
- `{read:"find", query}` is the `find` step; `{read:"describe", target}` returns the element description; `scroll:300`, `scroll:"-200"` and `scroll:{x,y}` scroll by pixels; `ref` is accepted as `target`.
- Stale refs are also matched by name without accents/case.

**Angular Material and old-style tables**
- Rows and cells with `cursor:pointer`, `aria-expanded` or an expand icon get a ref (`clk "123 · Percorso sicurezza · Approvato"`), without the `!c` confirmation meant for submit buttons.
- Icon-only buttons are named from `mattooltip`/`title` or the Material ligature (`delete` → `~elimina`, `expand_more` → `~espandi`).
- Fields whose only name is a binding (`ricercaAttivitaViewComponent.idPiano`) take the label of the neighbouring cell or column header (`Id Piano`), or a readable form of the binding.

Tests: new `test/v0511.mjs` (25 checks), all previous suites green, live 9/9.

**IT** — Correzioni dall'analisi di 221 chiamate reali: `filter` con `|` accetta alternative e ripiega sul testo della pagina; avvisi Struts e "Attenzione!" riconosciuti, niente falsi avvisi da prezzi e contatori; il `fill` riletto dopo la validazione del sito avvisa se il valore non è stato accettato (con il testo dell'alert); clic lenti considerati riusciti se la pagina è cambiata, altrimenti l'errore nomina il modale che copre; le schede aperte dalle pubblicità restano in sfondo; i popup promozionali si chiudono da soli (`CB_CLOSE_POPUPS`); alias `read:"find"`/`"describe"` e `scroll` numerico nei passi; righe Angular cliccabili, pulsanti con sola icona e campi in tabella con un nome leggibile.
## 0.5.10

**Hang limits that are really short** (fix of the 0.5.9 timeouts, which still allowed up to 180 s).
- `browse_do` now gets a time budget computed from its steps (15 s + a few seconds per step, 35 s per navigation, the `waitFor` timeout), capped at **90 s** instead of 180 s. Other tools: open/search 60 s, read 45 s, view/screenshot 30 s, task 90 s.
- `browse_do {tab:"list"}` answers in milliseconds: it lists the tabs without touching the pages and doesn't queue behind a stuck call (test: 3 ms with a frozen renderer and a call pending).
- Time spent waiting for the user to solve a verification (`CB_HUMAN_WAIT`) is not counted against the limit, so the CAPTCHA pause works as before.
- Test with a page whose renderer freezes: a step on it ends with an error after 23 s, then the tab is restored.

**IT** — Limiti di attesa davvero brevi: `browse_do` calcola il tempo massimo dai passi (al massimo 90 s, prima 180 s); `tab:"list"` risponde subito anche con una scheda bloccata e non aspetta le altre chiamate; l'attesa di una verifica risolta dall'utente non conta nel limite.

## 0.5.9

Shopping and comparison sites (Trovaprezzi, idealo, Unieuro, Amazon) and robustness after long sessions. Live check in real-Chrome mode: idealo category with 36 cards, sorted by total price in 0.6 s; `filter:"samsung"` + `maxPrice:500` gives 4 cards in 87 ms; a product page's fields are read in a background tab in 6.7 s and then come from the cache in 2 ms.

**Reliability**
- **Browser that hangs**: every tool has a timeout (45–180 s, longer when a human verification is pending), so a call no longer stays stuck for minutes. On `No frame with given id`, `Target closed`, a crashed renderer or a timeout, Colibri reopens the tab on the same URL. Reads, opens and searches are retried once by themselves; actions return "tab restored: repeat the step".
- **Cards on category pages**: when no group of similar siblings is found, cards fall back to repeated elements with a link spread over different containers, and grid rows that hold several products are split into single products.
- **Wrong URLs flagged**: `browse_open` reports HTTP 404/400/410 ("the URL doesn't exist: use `search`"). `browse_open {url, search:"..."}` opens the site and uses its own search box; when the result URL has the query in a parameter, it is saved as the site's search template for next time. Pages that reload themselves right after loading no longer give errors.
- **Hard blocks** (Access Denied, 403 pages of anti-bot services) are reported at once, with the suggestion to use real-Chrome mode, instead of waiting for a verification that will never appear. Nothing is bypassed.

**Fewer tokens on listings**
- **Total price**: cards show `tot 388,99€ (sped 19,99€)` when shipping is paid. Reference prices go to a separate field `rif 599€ consigliato -25%`, with `⚠ sconto non plausibile` above 50% and "(not a sale price)" for list/recommended prices. Conditional discounts ("10% extra in cart", coupons, with subscription) go to `cond:"…" non confermato` and are not applied to the price. Savings amounts ("Risparmi 9,87 € (-17%)") are not taken for prices.
- **Sort and filter while reading**: `read:"cards"` accepts `sort:"price"|"-price"` (total price), `filter:"nero -ricondizionato"` (words, `-` excludes) and `maxPrice`. Only matching cards are returned.
- **Only the fields you ask for**: `browse_read {mode:"fields", query:"prezzo, classe energetica, dimensioni"}` returns one line per key from spec tables, `dt/dd` and "Label: value" lines; `dimensioni` is composed from width/height/depth.
- **Cache**: pages read in the last 10 minutes are served from memory ("(dalla cache)"); `fresh:true` reloads.
- **Parallel reads**: `browse_read {url}` and `browse_search` run in separate background tabs (up to 3) without touching the active tab, so several of them can run together. `browse_search` also accepts `site`.
- **Coherence warnings**: when the same model shows a different value for the same field on another site, the line adds `⚠ … su altro-sito (stesso modello): verifica la fonte`.

**Privacy**
- `utm_*`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid` and similar are removed from URLs opened by Colibri (`CB_STRIP_TRACKING=false` or the "Togli i parametri di tracciamento" option to keep them).

Tests: `test/v059.mjs` (39) and full suite green.

**IT** — Siti di confronto prezzi e robustezza nelle sessioni lunghe.
- Ogni strumento ha un timeout. Se il frame si perde o la scheda va in crash, Colibri la riapre sulla stessa pagina e ripete da solo letture, aperture e ricerche.
- `read:"cards"` funziona anche sulle pagine di categoria (griglie di prodotti, liste senza gruppi di fratelli).
- Gli URL che danno 404 o 400 vengono segnalati. `browse_open {search}` usa la ricerca del sito e ne ricorda il modello.
- Le schede mostrano il prezzo totale con la spedizione, il prezzo di riferimento separato (con avviso se lo sconto non è plausibile) e gli sconti condizionati come "non confermato".
- `read:"cards"` accetta `sort`, `filter` e `maxPrice`.
- `read:"fields"` estrae solo i campi chiesti.
- Le pagine viste negli ultimi 10 minuti arrivano dalla cache.
- Letture con `url` e ricerche girano in schede in background, in parallelo.
- Avviso quando due siti danno valori diversi per lo stesso modello.
- Vengono tolti i parametri di tracciamento (utm, gclid, gbraid...).

## 0.5.8

Fewer calls and tokens on real sites (Vinted, Amazon, Wikipedia, hotel calendars, checkout pages). On the same scenarios reproduced locally (`npm run bench:pages`), 0.5.7 needed 17 calls and ~2500 tokens, 0.5.8 needs 8 calls and ~690 tokens (-72%).

| Scenario | 0.5.7 | 0.5.8 |
|---|---|---|
| 8 listings with their links (Vinted) | 10 calls, ~534 tok | 2 calls, ~192 tok |
| Review text (Amazon, Wikipedia) | ~714 tok | ~287 tok |
| Opening a 2-month calendar (Meliá) | ~305 tok | ~104 tok |
| Discount code accepted or rejected | 3 calls, ~949 tok (screenshot) | 2 calls, ~110 tok |

- **Cards with links**: `read:"cards"` with `links:true` adds each result's URL. Tracking parameters (`utm_`, `ref`, `gclid`...), `/ref=` path segments and Amazon title slugs (`/dp/ASIN`) are removed; a shared origin is written once. No more one `describe` per result.
- **Main text only**: `read:"text"` skips nav, header, footer, sidebars, cookie banners and blocks made almost only of links. A note says how much was cut; `selector:"body"` gives everything. Lines of JavaScript/JSON that leak into page text are dropped (also from the new-text lines after a click).
- **Compact calendars and lists**: consecutive buttons with consecutive numbers and refs (days, pages, sizes) become one line per month: `e100..e130 btn "1".."31" (31, ...)`, in views and diffs.
- **Visible state without screenshots**: fields show `ok` (green/accepted) or `inv` plus their message, e.g. `e1 text "Codice sconto" ok »"Codice applicato: -10%"`. Success messages, progress bars (`! avanzamento Coda: 40%`) and a cookie banner that is still open (with its button refs) appear as `!` lines.
- **Filter URL memory**: when clicks change only the query of the same page (filters, sort), the resulting URL is saved per site with the path of clicks; `browse_open` on that site shows it as a template. URLs with tokens, sessions, codes or CAPTCHA responses are never saved.
- **Useless tabs closed**: tabs opened by a click that stay `about:blank` or land on ad/affiliate/tracking hosts are closed; at the end of `browse_do`, Colibri closes background tabs it opened that are junk or duplicates and keeps at most 3. The user's own tabs are never touched.
- **Tool profiles** (`CB_TOOLS` or the "Profilo dei tool" option): `all` (default, ~1715 tokens per turn), `lite` = search, open, do, read (~1060), `read` = search, open, read (~550), or a list like `search,open,read`. Instructions mention only the active tools.
- Amazon cards: leading/trailing boxes without prices (bestseller widgets, headers) are skipped, and text equal to a button label is not repeated.

Tests: `test/v058.mjs` (31), full suite (256), live tests green; new `npm run bench:pages`.

**IT** — Meno chiamate e token sui siti reali: negli scenari della sessione si passa da 17 chiamate e circa 2500 token a 8 chiamate e circa 690 token (−72%).
- `read:"cards"` con `links:true` dà l'URL di ogni risultato, senza parametri di tracciamento.
- `read:"text"` restituisce solo il contenuto principale, senza menu, intestazioni, piè di pagina, banner dei cookie e righe di codice.
- I calendari diventano una riga per mese.
- I campi mostrano `ok` o `inv` con il loro messaggio (codice sconto applicato o rifiutato) senza screenshot. Avanzamento e banner dei cookie aperto compaiono come righe `!`.
- L'URL dei filtri viene ricordato per sito e mostrato all'apertura.
- Le schede inutili (pubblicità, affiliazioni, `about:blank`) si chiudono da sole.
- Ci sono profili di tool (`CB_TOOLS`: all, lite, read) per pagare meno definizioni a ogni turno.
## 0.5.7

`read:"cards"` picks the real results on portals like Trenitalia. Before, it could return 20 filter chips (`[e130 1 cambio] | [e131] | [e132]`) instead of the 10 travel solutions, without times or prices.

Causes found and fixed (reproduced in `test/fixtures/soluzioni.html`):

- **`display:contents` components** (Angular/Lit hosts such as `<app-solution>`) have no box, so they counted as invisible. Visibility now looks at their children.
- **Variants split the group**: direct and with-change solutions had different classes. Siblings now group by tag plus any shared class, including the classes of their first child.
- **Screen-reader text inflated the score**: the chips looked rich because `innerText` counted hidden labels. The score now measures only visible text and gives extra weight to groups with times and prices.
- **Large pages**: only the first 8000 nodes were scanned, so results after a huge hidden menu were never seen. The scan now skips `display:none` branches and goes up to 40000 nodes.
- **Times marked `aria-hidden`** but visible were dropped. Visible text is now kept (icon ligatures are still skipped).
- **Screen-reader summaries** ("Soluzione n. 1 ; partenza ore 18:28 arrivo ore 19:16") are added to the row only when they carry times, prices or dates not visible on screen, so there is no duplication.
- Unlabeled buttons in a card take their hidden text as label. `selector` works on `display:contents` elements and returned only the first 4 matches before.

Tests: `test/v057.mjs` (11), full suite and live tests green. Same tokens and times on `npm run bench:task`.

**IT** — `read:"cards"` sceglie i risultati veri anche su portali come Trenitalia, invece delle 20 chip dei filtri. Le cause corrette:
- i componenti `display:contents` erano considerati invisibili;
- le varianti (diretto o con cambio) finivano in gruppi diversi;
- il testo per i lettori di schermo gonfiava il punteggio;
- venivano esaminati solo i primi 8000 nodi;
- gli orari visibili ma `aria-hidden` venivano scartati.

Il riassunto per i lettori di schermo entra nella riga solo se porta orari, prezzi o date che non si vedono.

## 0.5.6

Fixes found while using 0.5.5 on real sites (Trenitalia, Trovaprezzi). Each one has a regression test (`test/v056.mjs`) that fails on 0.5.5.

**English**
- **`browse_task` read after a submit that changes page**: when the submit leads to another page (even another domain) whose results appear in waves, the task now waits for the new document and retries `read:"cards"`/`"table"` for up to ~8 s instead of answering "no repeated card group".
- **Drop-down buttons**: a parameter that matches a collapsed button (for example the time on Trenitalia) is no longer just "none 100%": the question now says it is a drop-down and how to use it (`before:[{"click":"eN"},{"click":"<option>"}]`).
- **Fields called `id`, `name`, `title` or `action`**: on a form with such a field the browser returns the element instead of the text, which made the page read fail with `(s || "").replace is not a function`. Ids, names and titles are now read with `getAttribute`.

**Italiano**
- **Lettura di `browse_task` dopo un invio che cambia pagina**: quando l'invio porta a un'altra pagina (anche di un altro dominio) con risultati che arrivano a ondate, il task aspetta il nuovo documento e riprova `read:"cards"`/`"table"` fino a ~8 s invece di rispondere "nessun gruppo di schede ripetute".
- **Pulsanti a tendina**: un parametro che corrisponde a un pulsante chiuso (per esempio l'ora su Trenitalia) non è più solo "nessuno 100%": la domanda dice che è una tendina e come usarla (`before:[{"click":"eN"},{"click":"<opzione>"}]`).
- **Campi chiamati `id`, `name`, `title` o `action`**: in un modulo con un campo così il browser restituisce l'elemento al posto del testo, e la lettura della pagina falliva con `(s || "").replace is not a function`. Ora id, nomi e titoli si leggono con `getAttribute`.

## 0.5.5

Measured on a repeated real task: search trains Wien Hbf → Salzburg Hbf at 18:00 and find the cheapest (`npm run bench:task`, 3 runs, all correct):

| Version | `browse_task` (1 call) | Steps (open + do) | Tool definitions per turn |
|---|---|---|---|
| 0.5.0 | ~385 tokens | ~859 tokens | ~1447 tokens (7 tools) |
| 0.5.4 | ~291 tokens | ~774 tokens | ~1669 tokens (8 tools) |
| **0.5.5** | **~176 tokens** | **~228 tokens** (`rows:false`, no `wait`) | **~1666 tokens** (8 tools) |

**English**
- **Lighter `browse_open`**: `rows:false` returns only the header (url, title, alerts, CAPTCHA/login lines) and element counts, for when you already know the field names. `filter` returns only the matching rows. On the train shop this is 153 characters instead of 1214.
- **Cards with refs**: in `read:"cards"` every button or link inside a card comes back with its ref (`… | € 9,90 | [e54]`), and a card that is a link as a whole ends with `→e60`. Choosing a result no longer needs another view. Texts present in every card (stations, the button label) go into one `in tutte:` line instead of being repeated on each row.
- **No repetition after a read**: when `browse_do` or `browse_task` ends with `read`/`find`, the diff no longer repeats the result texts (`»` lines) or the new buttons already listed with their ref (`+ 6 nuovi gia' elencati…`). If the page changed, only the header and counts follow instead of the full view. `browse_task` with `read` drops the form button list.
- **Network-based waits before reading**: `read` and `find` (step or `browse_read`) wait for pending requests and, while the network is busy, for visible spinners. Results loaded after a click are read without `wait`/`waitFor`. A decorative spinner on an idle page adds no delay.
- Tool definitions shortened: the new options cost no extra tokens per turn compared with 0.5.4.
- New benchmark `test/bench-task.mjs` with a realistic SPA train shop (`test/fixtures/orari.html`): calls, tokens and seconds per version (`node test/bench-task.mjs path/to/old/index.js`).

**Italiano**
- **`browse_open` più leggero**: `rows:false` restituisce solo l'intestazione (url, titolo, avvisi, righe CAPTCHA/accesso) e il numero di elementi, quando conosci già i nomi dei campi. `filter` restituisce solo le righe che corrispondono. Sullo shop treni sono 153 caratteri invece di 1214.
- **Schede con i ref**: in `read:"cards"` ogni pulsante o link dentro una scheda esce con il suo ref (`… | € 9,90 | [e54]`), e una scheda che è un link intero finisce con `→e60`. Per scegliere un risultato non serve un'altra vista. I testi presenti in tutte le schede (stazioni, etichetta del pulsante) vanno in una riga `in tutte:` invece di ripetersi su ogni riga.
- **Niente ripetizioni dopo una lettura**: quando `browse_do` o `browse_task` finisce con `read`/`find`, il diff non ripete i testi dei risultati (righe `»`) né i nuovi pulsanti già elencati col loro ref (`+ 6 nuovi gia' elencati…`). Se la pagina è cambiata seguono solo intestazione e conteggi invece della vista completa. `browse_task` con `read` non elenca più i pulsanti del modulo.
- **Attese basate sulla rete prima di leggere**: `read` e `find` (passo o `browse_read`) aspettano la fine delle richieste in corso e, finché la rete è occupata, gli spinner visibili. I risultati caricati dopo un clic si leggono senza `wait`/`waitFor`. Uno spinner decorativo su una pagina ferma non aggiunge attese.
- Definizioni dei tool accorciate: le nuove opzioni non costano token in più a ogni turno rispetto alla 0.5.4.
- Nuovo banco di prova `test/bench-task.mjs` con uno shop treni SPA realistico (`test/fixtures/orari.html`): chiamate, token e secondi per versione (`node test/bench-task.mjs percorso/vecchio/index.js`).

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
