# Changelog

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
