# Confronto con gli altri metodi

Sette modi di far usare un browser a Claude, misurati sugli stessi compiti e sulle stesse pagine. Tutti hanno completato tutti i compiti (verifica automatica dello stato finale: riepilogo letto, protocollo ricevuto, dati giusti).

Per riprodurre: `npm ci && npm run bench` (serve Google Chrome installato). Risultati completi, chiamata per chiamata: [benchmark-results.json](benchmark-results.json).

## I metodi

| Metodo | Dove si usa | Come lavora nel benchmark |
|---|---|---|
| **Screenshot** | computer use, Claude in Chrome a screenshot | Un'azione per chiamata (clic a coordinate, digitazione, scorrimento) e uno screenshot 1280×800 dopo ognuna. Simulato con Playwright eseguendo davvero ogni azione. |
| **Playwright MCP** 0.0.83 (Microsoft) | Claude Desktop, Claude Code | Snapshot YAML della pagina quando servono riferimenti o risultati; `browser_fill_form` per più campi insieme. |
| **Browser compatto** (questo progetto) | Claude Desktop | Tabella compatta, passi in blocco, risposta con le sole differenze. |
| **Browser compatto, `browse_task`** | Claude Desktop | Stesso server, ma Claude passa i dati con le etichette dell'utente e il motore locale decide campi, menu, autocompletamenti e date (vedi [calibrazione.md](calibrazione.md)). In T1 la pagina non viene mai mostrata per intero; in T3 il nome del collegamento è quello della richiesta dell'utente ("apri l'elenco progetti"). |
| **agent-browser CLI** 0.41 (Vercel) | Claude Code (comandi nella shell) | Come chiede la sua skill: carica la guida `skills get core`, poi `batch` di comandi, `snapshot -i` (solo elementi interattivi), `snapshot -i --delta` per vedere solo i cambiamenti, `find` e `get text`. |
| **agent-browser CLI senza guida** | idem | Stessa sequenza, ma l'agente conosce già i comandi e non carica la guida (circa 9.600 token in meno). |
| **agent-browser MCP** 0.41, profilo `core` | Claude Desktop | La configurazione MCP predefinita. Il profilo `core` non contiene il comando in blocco, quindi un'azione per chiamata. |
| **Fast Playwright MCP** 0.2 | Claude Desktop, Claude Code | Catalogo adattivo (7 tool visibili), `browser_batch_execute` con snapshot disattivato e diff minimo, lettura limitata a `main`. |

Ogni concorrente è usato nel modo più efficiente che la sua documentazione suggerisce. Quando un passo fallisce, l'agente simulato fa ciò che farebbe un agente vero (legge l'errore, corregge, ripete i passi rimasti) e la chiamata in più viene contata.

## I compiti

- **T1 — Domanda su due pagine.** Rifiutare i cookie, compilare 22 campi (testo, numeri, date, 4 menu di cui uno dipendente dalla regione, autocompletamento del comune, scelta radio), spuntare le due dichiarazioni dopo la conferma dell'utente, passare alla pagina 2, leggere il riepilogo, inviare con conferma nella finestra modale, leggere il numero di protocollo.
- **T2 — Elenco → dettaglio.** In un elenco di 25 progetti aprire il dettaglio di PF-2026-115 e leggere la tabella delle edizioni.
- **T3 — Navigazione.** Dalla home (intestazione, menu e piè di pagina pesanti) aprire l'elenco progetti e leggere quanti sono.

## Risultati

Colonne: chiamate al tool; token restituiti dai tool; risposta singola più grande; contesto alla fine; contesto riletto in totale (somma su tutti i turni, è ciò che pesa di più su consumo e lentezza); token generati dal modello; tempo nel browser; tempo totale stimato.

### T1 — Domanda su due pagine

| Metodo | Chiamate | Token pagine | Max singola | Contesto finale | Riletto in totale | Generati | Browser | Totale |
|---|---|---|---|---|---|---|---|---|
| Screenshot | 54 | 74.304 | 1.366 | 83.725 | 2.480.688 | 3.071 | 20,6 s | 154,3 s |
| Playwright MCP | 14 | 23.421 | 5.354 | 34.198 | 318.910 | 1.391 | 6,1 s | 51,8 s |
| agent-browser MCP | 40 | 16.943 | 4.464 | 41.889 | 1.373.730 | 2.219 | 9,7 s | 108,2 s |
| agent-browser CLI | 6 | 18.972 | 9.614 | 27.458 | 149.403 | 1.341 | 9,8 s | 42,6 s |
| agent-browser CLI senza guida | 5 | 9.358 | 4.576 | 17.794 | 84.124 | 1.291 | 9,1 s | 39,6 s |
| Fast Playwright MCP | 7 | 11.151 | 5.283 | 20.160 | 115.624 | 1.748 | 16,0 s | 57,1 s |
| **Browser compatto** | 4 | 1.191 | 634 | 9.053 | 41.690 | 734 | 4,6 s | 24,3 s |
| **Browser compatto, `browse_task`** | 3 | 702 | 348 | 8.381 | 31.611 | 551 | 4,7 s | 19,9 s |

### T2 — Elenco → dettaglio

| Metodo | Chiamate | Token pagine | Max singola | Contesto finale | Riletto in totale | Generati | Browser | Totale |
|---|---|---|---|---|---|---|---|---|
| Screenshot | 3 | 4.128 | 1.366 | 10.809 | 34.630 | 331 | 1,5 s | 13,1 s |
| Playwright MCP | 4 | 10.698 | 6.982 | 20.434 | 73.333 | 350 | 1,8 s | 15,1 s |
| agent-browser MCP | 5 | 7.627 | 7.266 | 30.754 | 167.751 | 400 | 2,5 s | 18,2 s |
| agent-browser CLI | 3 | 17.146 | 9.614 | 24.673 | 73.274 | 382 | 2,4 s | 14,8 s |
| agent-browser CLI senza guida | 2 | 7.532 | 7.295 | 15.009 | 36.987 | 332 | 2,4 s | 12,4 s |
| Fast Playwright MCP | 2 | 8.069 | 6.942 | 15.647 | 37.480 | 317 | 2,2 s | 12,0 s |
| **Browser compatto** | 2 | 1.101 | 821 | 8.505 | 23.943 | 276 | 1,6 s | 10,7 s |
| **Browser compatto, `browse_task`** | 2 | 1.025 | 824 | 8.432 | 23.873 | 279 | 1,5 s | 10,6 s |

### T3 — Navigazione

| Metodo | Chiamate | Token pagine | Max singola | Contesto finale | Riletto in totale | Generati | Browser | Totale |
|---|---|---|---|---|---|---|---|---|
| Screenshot | 2 | 2.752 | 1.366 | 9.369 | 23.809 | 267 | 1,0 s | 10,0 s |
| Playwright MCP | 4 | 12.301 | 7.703 | 22.034 | 69.739 | 347 | 1,9 s | 15,1 s |
| agent-browser MCP | 5 | 3.382 | 2.155 | 26.506 | 148.169 | 397 | 1,3 s | 16,9 s |
| agent-browser CLI | 3 | 11.821 | 9.614 | 19.354 | 62.842 | 388 | 1,5 s | 14,0 s |
| agent-browser CLI senza guida | 2 | 2.207 | 2.186 | 9.690 | 26.555 | 338 | 1,5 s | 11,6 s |
| Fast Playwright MCP | 2 | 9.677 | 5.341 | 17.254 | 36.480 | 316 | 2,1 s | 11,8 s |
| **Browser compatto** | 2 | 487 | 459 | 7.892 | 22.967 | 277 | 1,8 s | 10,9 s |
| **Browser compatto, `browse_task`** | 1 | 73 | 73 | 7.433 | 14.711 | 232 | 1,7 s | 8,6 s |

### Peso di una lettura del modulo (pagina 1 di T1)

| Metodo | Token |
|---|---|
| Browser compatto | 634 |
| Screenshot | 1.366 per schermata (il modulo intero ne richiede 3) |
| agent-browser MCP, `snapshot` interattivo | 4.396 |
| agent-browser CLI, `snapshot -i` | 4.430 |
| Fast Playwright MCP, snapshot alla navigazione | 5.283 |
| Playwright MCP, `browser_snapshot` | 5.285 |

La differenza viene da: menu, intestazione e piè di pagina compressi; opzioni dei menu lunghi riassunte (97 codici ATECO diventano `opz:97`); nessun nodo strutturale; righe di tabella ripetute riassunte.

### Definizioni sempre presenti nel contesto

| Metodo | Token |
|---|---|
| Browser compatto (7 tool, `browse_task` compreso) | 2.278 |
| agent-browser CLI | ~2.295 (skill installata 795 + tool Bash, ipotesi 1.500) |
| Fast Playwright MCP | 2.411 |
| Playwright MCP | 4.536 |
| agent-browser MCP, profilo `core` | 17.877 (con i comandi in blocco, profilo `core,debug`: circa 48.000) |

## In sintesi

- **Compito lungo (T1).** Con `browse_task` bastano 3 chiamate: 702 token di risposte, 31.611 di contesto riletto, circa 20 secondi. Rispetto al concorrente migliore (agent-browser CLI senza guida) sono il 92% di token in meno nelle risposte, il 62% in meno di contesto riletto e circa 20 secondi in meno. Rispetto al browser compatto a passi espliciti: una chiamata e il 24% di contesto in meno, perché Claude non deve leggere il modulo per poi riscriverne le etichette.
- **Elenco → dettaglio (T2).** `browse_task` non aiuta: Claude deve comunque vedere l'elenco per sapere quale collegamento aprire. Due chiamate, come i metodi a blocchi migliori; il browser compatto resta il più leggero in token (23.943 di contesto riletto contro 36.987).
- **Navigazione (T3).** Una sola chiamata (apertura, clic e numero estratto) e 73 token di risposta: 14.711 di contesto riletto contro 26.555 del concorrente migliore, e su questo compito supera anche lo screenshot, che prima era il più veloce (8,6 s contro 10,0 s).
- **Il prezzo di `browse_task`**: la sua definizione aggiunge 639 token al contesto di ogni turno (da 1.639 a 2.278). È già compreso in tutti i numeri del browser compatto qui sopra.
- In Claude Desktop, gli unici concorrenti utilizzabili senza terminale sono quelli MCP: lì agent-browser paga 17.877 token di definizioni a ogni turno e un'azione per chiamata; Fast Playwright MCP è il più vicino, ma con snapshot 8-10 volte più grandi.

## Problemi incontrati dai concorrenti (riproducibili)

- **agent-browser**: `select` sul menu Provincia, che si riempie dopo la scelta della Regione, fallisce invece di attendere; serve un nuovo tentativo con attesa. `fill` su un campo data nativo risponde "Done" ma lascia il campo vuoto: l'errore emerge solo quando il portale rifiuta il modulo (nel benchmark l'agente usa direttamente `eval`, senza contare i tentativi falliti). `diff snapshot` da riga di comando restituisce l'albero completo a ogni chiamata in questa versione; funziona invece `snapshot -i --delta`. Le risposte MCP includono circa 440 caratteri di dati di servizio per ogni azione.
- **Fast Playwright MCP**: i selettori per ruolo e testo non trovano i campi etichettati (servono i riferimenti dello snapshot); un testo ambiguo ("Ischia" e "Barano d'Ischia") ferma il blocco; un clic che cambia pagina dopo 200 ms manda in errore la cattura dello stato ("Execution context was destroyed") e servono riletture, con un numero di token che varia tra un'esecuzione e l'altra (11-14 mila in T1).
- **Playwright MCP**: nessun problema; più chiamate perché dopo ogni cambio di pagina serve uno snapshot completo.

## Ipotesi

- Contesto iniziale di 5.000 token (prompt di sistema e richiesta) più le definizioni dei tool.
- 40 token generati per ogni chiamata oltre agli argomenti; 150 token di risposta finale.
- 1,5 s di attesa più 60 token/s di generazione per ogni turno del modello.
- Le conferme dell'utente (dichiarazioni, invio) sono uguali per tutti i metodi e non contate come chiamate.
- Token contati con il tokenizer pubblico di Claude; screenshot con la formula ufficiale larghezza × altezza / 750.

## Limiti del confronto

- **Le pagine di prova le ho costruite io mentre sviluppavo il browser compatto**, sul modello dei portali istituzionali: il mio tool gioca in casa. I difetti dei concorrenti elencati sopra sono comportamenti reali, ma su siti diversi i numeri e gli errori possono cambiare in entrambe le direzioni.
- Gli agenti sono simulati con sequenze scritte a mano: un modello vero può sbagliare di più (più chiamate) o trovare scorciatoie (meno chiamate).
- Con `browse_task` il risultato di T1 dipende dal motore di abbinamento: su questa pagina abbina da solo tutti i 21 dati, ma su pagine con un vocabolario che non conosce farà domande, e ogni domanda costa una chiamata in più (vedi [calibrazione.md](calibrazione.md)).
- I tempi del browser variano tra un'esecuzione e l'altra, soprattutto per agent-browser CLI (da 4 a 10 secondi in T1 su due esecuzioni).
- Claude in Chrome può leggere la pagina come testo e fare più azioni per turno, quindi nella pratica sta tra la riga "Screenshot" e quelle degli strumenti a testo; non è misurato direttamente.
- I modelli Claude più recenti contano circa il 30% di token in più sul testo rispetto al tokenizer pubblico: le cifre dei metodi testuali salirebbero, quelle degli screenshot no.
