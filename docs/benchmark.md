# Confronto con il metodo normale

Tre modi di far usare un browser a Claude, misurati sugli stessi compiti e sulle stesse pagine. Tutti e tre i metodi hanno completato tutti i compiti correttamente (verifica automatica dello stato finale).

Per riprodurre: `npm ci && npm run bench` (serve Google Chrome installato). I risultati completi sono in [benchmark-results.json](benchmark-results.json).

## I tre metodi

| Metodo | Come lavora |
|---|---|
| **Screenshot** | Un'azione per chiamata (clic a coordinate, digitazione, scorrimento) e uno screenshot 1280×800 dopo ogni azione, come un agente "computer use". Simulato con Playwright eseguendo davvero ogni azione. |
| **Albero di accessibilità** | [Playwright MCP](https://github.com/microsoft/playwright-mcp) 0.0.83, il server MCP per browser più diffuso. L'agente chiede lo snapshot YAML della pagina quando gli servono i riferimenti o deve leggere un risultato, e usa `browser_fill_form` per compilare più campi insieme. |
| **Browser compatto** | Questo progetto: tabella compatta, passi in blocco, risposta con le sole differenze. |

## I compiti

- **T1 — Domanda su due pagine.** Rifiutare i cookie, compilare 22 campi (testo, numeri, date, 4 menu di cui uno dipendente dalla regione, autocompletamento del comune, scelta radio), spuntare le due dichiarazioni dopo la conferma dell'utente, passare alla pagina 2, leggere il riepilogo, inviare con conferma nella finestra modale, leggere il numero di protocollo.
- **T2 — Elenco → dettaglio.** In un elenco di 25 progetti aprire il dettaglio di PF-2026-115 e leggere la tabella delle edizioni.
- **T3 — Navigazione.** Dalla home (intestazione, menu e piè di pagina pesanti, 150+ link) aprire l'elenco progetti e leggere quanti sono.

## Risultati

| Compito | Metodo | Chiamate | Token delle pagine | Risposta più grande | Contesto finale | Contesto riletto in totale | Token generati | Tempo browser | Tempo totale stimato |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Screenshot | 54 | 74.304 | 1.366 | 83.725 | 2.480.688 | 3.071 | 19,9 s | 153,6 s |
| T1 | Playwright MCP | 14 | 23.421 | 5.354 | 34.198 | 318.910 | 1.391 | 5,4 s | 51,1 s |
| T1 | **Browser compatto** | **4** | **1.191** | **634** | **8.414** | **38.495** | **734** | 4,4 s | **24,2 s** |
| T2 | Screenshot | 3 | 4.128 | 1.366 | 10.809 | 34.630 | 331 | 1,3 s | 12,9 s |
| T2 | Playwright MCP | 4 | 10.698 | 6.944 | 20.434 | 73.371 | 350 | 1,6 s | 14,9 s |
| T2 | **Browser compatto** | **2** | **1.101** | **821** | **7.866** | **22.026** | **276** | 1,4 s | **10,5 s** |
| T3 | Screenshot | 2 | 2.752 | 1.366 | 9.369 | 23.809 | 267 | 1,1 s | **10,0 s** |
| T3 | Playwright MCP | 4 | 12.301 | 7.703 | 22.034 | 69.739 | 347 | 1,4 s | 14,7 s |
| T3 | **Browser compatto** | **2** | **487** | **459** | **7.253** | **21.050** | **277** | 1,5 s | 10,7 s |

Definizioni dei tool, sempre presenti nel contesto: browser compatto 1.639 token, Playwright MCP 4.536 token.

Indicativo, prezzi API di Claude Sonnet 5.5 senza cache: T1 costa 4,99 $ a screenshot, 0,65 $ con Playwright MCP, 0,08 $ con il browser compatto. Con un abbonamento Claude non si paga a token, ma lo stesso consumo pesa sui limiti d'uso.

## Cosa significano le colonne

- **Token delle pagine**: somma di tutto ciò che i tool restituiscono (testo contato con il tokenizer pubblico di Claude; screenshot con la formula ufficiale larghezza × altezza / 750 = 1.366 token).
- **Contesto riletto in totale**: a ogni chiamata il modello rilegge l'intera conversazione; è la somma su tutti i turni. È il numero che più incide su consumo e lentezza nei compiti lunghi.
- **Tempo totale stimato**: tempo reale misurato nel browser + tempo stimato del modello.

## Ipotesi

- Contesto iniziale di 5.000 token (prompt di sistema e richiesta) più le definizioni dei tool; per il metodo screenshot le definizioni sono stimate in 1.500 token.
- 40 token generati per ogni chiamata oltre agli argomenti; 150 token di risposta finale.
- 1,5 s di attesa più 60 token/s di generazione per ogni turno del modello.
- Le conferme dell'utente (dichiarazioni, invio) sono considerate uguali per tutti i metodi e non contate come chiamate.

## Limiti del confronto

- Le pagine sono di prova, costruite sul modello dei portali istituzionali (intestazione e menu pesanti, banner cookie, moduli lunghi, tabelle, finestre modali). Su siti reali i numeri cambiano.
- Il metodo screenshot è una simulazione: un agente reale può sbagliare e ripetere azioni (più chiamate) oppure raggrupparne alcune (meno chiamate). Claude in Chrome può anche leggere la pagina come testo e fare azioni in blocco, quindi nella pratica sta tra la riga "Screenshot" e la riga "Playwright MCP".
- I modelli Claude più recenti usano un tokenizer che conta circa il 30% di token in più sul testo rispetto a quello pubblico usato qui: le cifre dei metodi testuali salirebbero di conseguenza, quelle degli screenshot no. Il vantaggio resta ampio.
- Sui compiti molto brevi (T3) lo screenshot è alla pari in tempo; il guadagno del browser compatto cresce con la lunghezza del compito.
