# Il motore decisionale di browse_task

Dalla versione 0.2 il browser compatto ha un piccolo motore locale che decide da solo i casi semplici e passa a Claude solo quelli incerti. L'idea viene da Jev (jevai.net): un "Sistema Uno" veloce risponde a domande tipizzate con una confidenza calibrata, e si agisce solo sopra una soglia. Qui non c'è nessun modello addestrato né servizio esterno: sono euristiche in JavaScript che girano nel server locale, con due soli parametri calibrati sui dati. Non costano token e non serve una chiave API.

## Il ciclo di un compito

```
osserva → valuta → decidi → abbina → controllo di sicurezza → agisci e verifica
```

1. **Osserva**: la pagina viene letta come tabella compatta (la stessa di `browse_view`), più le etichette complete, i segnaposto, le opzioni dei menu e i titoli dei gruppi.
2. **Valuta**: per ogni parametro (`"P.IVA": "01234567890"`) il motore pone una domanda di **scelta** tra i campi della pagina, con l'opzione **nessuno**.
3. **Decidi**: dalla distribuzione delle probabilità ricava la confidenza e la confronta con la soglia del profilo scelto.
4. **Abbina (assegnazione congiunta)**: due parametri sullo stesso campo? Resta il più sicuro. Dalla v0.4 i parametri incerti o contesi riprovano sui soli campi rimasti liberi, finché non cambia più nulla: un campo già preso non fa più concorrenza agli altri.
5. **Controllo di sicurezza**: `!x` (password, carte, OTP, IBAN) mai; `!c` (consensi, invio, elimina, carica file) solo con `confirm: true` dopo l'ok dell'utente; invio bloccato se restano domande, errori o campi obbligatori vuoti.
6. **Agisci e verifica**: compila in ordine di pagina, aspetta i menu dipendenti, sceglie il suggerimento dell'autocompletamento con un'altra domanda di scelta, adatta le date al formato del campo, poi rilegge i valori.

Ciò che il motore non sa decidere torna a Claude come domanda:

```
? "ubicazione": e605 "Sede di svolgimento" 54% · nessuno 43% · e612 "Argomenti trattati" 1%
rispondi con answers: {"parametro": "ref"} (vengono ricordate per questo sito)
```

La risposta di Claude viene salvata in una **memoria per sito** (`site-memory.json` accanto al profilo del browser): la volta successiva lo stesso parametro sullo stesso sito non genera domande.

## Come si calcola la confidenza

Per ogni campo candidato il motore calcola un punteggio (logit):

| Componente | Peso | Cosa misura |
|---|---|---|
| Somiglianza dell'etichetta | 7 | concetti (dizionario di sinonimi in 6 lingue: "P.IVA" = "Partita IVA" = "USt-IdNr." = "Numéro de TVA"), parole in comune anche con radice diversa, lettere in comune |
| Compatibilità del valore | 2 | un'email in un campo email, una data in un campo data, un orario (`09:30`) in un campo `hh:mm`, un percorso in un campo file, un'opzione esistente in un menu; un testo in una casella o in un radio singolo è incompatibile |
| Esclusività (v0.4) | +2,5 | il valore ha una forma inconfondibile (orario, file; data, email e sì/no solo con un indizio nel nome) e nella pagina c'è **un solo** campo adatto |
| Memoria del sito | 9 | risposta già data dall'utente su questo sito |
| Gruppo di campi | 0,8 | somiglianza con il titolo della sezione ("Dati del referente") |
| Obbligatorio / in zona secondaria | +0,15 / −1 | |

L'opzione **nessuno** ha un logit fisso. Le probabilità sono una softmax con temperatura T. La confidenza è la probabilità della scelta migliore, il margine è la distanza dalla seconda.

| Profilo | Agisce se | oppure se |
|---|---|---|
| `cautious` | confidenza ≥ 0,90 | confidenza ≥ 0,70 e margine ≥ 0,30 |
| `balanced` (predefinito) | confidenza ≥ 0,85 | confidenza ≥ 0,55 e margine ≥ 0,25 |
| `autonomous` | confidenza ≥ 0,60 | confidenza ≥ 0,20 e margine ≥ 0,10 |

Se vince "nessuno", il motore chiede sempre.

## Calibrazione

T e il logit di "nessuno" sono stati stimati minimizzando la log-verosimiglianza negativa con un piccolo label smoothing (EPS), scelto in base all'errore di calibrazione (ECE) su addestramento e Test 1. Valori finali (v0.4): **T = 0,9, nessuno = 4, EPS = 0,01** (v0.3: T = 0,85). Lo script è `npm run calibrate` (`test/calibrate.mjs`); `VERIFY5=1 npm run calibrate` aggiunge il Test 5.

Sei insiemi di casi, ognuno con anche casi negativi (parametri che nella pagina non hanno un campo, dove la risposta giusta è "nessuno"):

| Insieme | Pagina | Casi | Ruolo |
|---|---|---|---|
| Addestramento | domanda di contributo (italiano) | 141 | stima di T e "nessuno" |
| Test 1 | registrazione fornitore in inglese, francese, spagnolo, tedesco | 140 | scelta di EPS |
| Test 2 | iscrizione a un corso | 41 | sviluppo |
| Test 3 | registro di una lezione | 29 | indipendente fino alla v0.3; i suoi errori hanno guidato la v0.4 |
| Test 4 | rimborso trasferta, nomi dei campi tecnici (`fld_01`…) | 35 | chiavi scritte prima della v0.4; i suoi errori hanno guidato la v0.4 |
| Test 5 | richiesta di intervento tecnico | 33 | **scritto dopo le modifiche al motore, misurato una sola volta: il numero indipendente della v0.4** |

| Insieme | Accuratezza v0.3 → v0.4 | ECE v0.3 → v0.4 | Decisi da solo (balanced) v0.3 → v0.4 | Precisione delle decisioni autonome v0.3 → v0.4 |
|---|---|---|---|---|
| Addestramento | 100% → 100% | 0,048 → 0,052 | 92,9% → 92,9% | 100% → 100% |
| Test 1 | 100% → 100% | 0,066 → 0,077 | 82,9% → 82,9% | 100% → 100% |
| Test 2 | 97,6% → 97,6% | 0,063 → 0,071 | 85,4% → 85,4% | 100% → 100% |
| Test 3 | 75,9% → 100% | 0,186 → 0,052 | 55,2% → 79,3% | 100% → 100% |
| Test 4 | 71,4% → 97,1% | 0,144 → 0,056 | 57,1% → 82,9% | **95,0%** → 100% |
| **Test 5** | **75,8% → 87,9%** | **0,114 → 0,046** | **60,6% → 72,7%** | 100% → 100% |
| Tutti (419 casi) | 93,8% → 98,6% | 0,024 → 0,059 | 80,7% → 85,4% | 99,7% → 100% |

Altre metriche su tutti i 419 casi (v0.3 → v0.4): **AUROC** della confidenza (quanto la confidenza separa le risposte giuste dalle sbagliate) 0,91 → 0,95; latenza per parametro a cache vuota p50 2,1 → 1,7 ms, p95 10,5 → 8,3 ms.

**Compito intero.** Lo script simula anche il compito completo come lo fa `browse_task`: tutti i parametri di un modulo insieme (una variante per ogni sinonimo, più i parametri senza campo), con l'assegnazione congiunta.

| Insieme | Campi compilati da solo v0.3 → v0.4 | Compilati sbagliati v0.3 → v0.4 | Tempo per compito v0.3 → v0.4 |
|---|---|---|---|
| Addestramento | 234/234 → 234/234 | 0 → 0 | 340 → 84 ms |
| Test 1 | 168/168 → 168/168 | 0 → 0 | 24 → 9 ms |
| Test 2 | 50/51 → 51/51 | 0 → 0 | 47 → 13 ms |
| Test 3 | 16/24 → 23/24 | 0 → 0 | 20 → 7 ms |
| Test 4 | 19/30 → 29/30 | **1** → 0 | 50 → 11 ms |
| Test 5 | 20/28 → 24/28 | 0 → 0 | 39 → 10 ms |

Nessun parametro "senza campo" è mai stato compilato (0 su 207). Il tempo scende nonostante l'assegnazione a più giri, grazie alla cache delle somiglianze tra etichette.

Risultati completi: [calibration-results.json](calibration-results.json).

### Cosa è cambiato nella v0.4

- **Tipi di valore "orario" e "percorso"**: `09:30` va nei campi con segnaposto `hh:mm`, `type=time` o nome "ora inizio/fine"; `C:\documenti\x.pdf` va nei campi file. Prima un orario era un testo qualsiasi.
- **Esclusività**: se il valore ha una forma inconfondibile e c'è un solo campo adatto, il campo riceve +2,5 (è il caso di "foglio firme" → "Allegato registro presenze").
- **Caselle e radio singoli accettano solo sì/no**. Nel Test 4 il motore v0.3 metteva "servizio: Ragioneria" nel radio "Auto di servizio" al 91%: l'unica decisione autonoma sbagliata di tutti gli insiemi, ora corretta.
- **Assegnazione congiunta** (`assign()` in `engine.js`, usata sia da `browse_task` sia dalla calibrazione).
- **Vocabolario**: concetti generici in 6 lingue per orari, luoghi, docenti, argomenti, motivi, importi, uffici, partenza e rientro, distanze, giustificativi, conferme; "cognome e nome" come nome completo; "orario" = "ora".
- **Cache** delle somiglianze e dei concetti; le note "abbinato al 9x%" compaiono solo per abbinamenti non ovvi.

### Come leggere questi numeri

- **I miglioramenti su Test 3 e Test 4 non sono indipendenti**: il vocabolario nuovo e l'esclusività sono nati guardando i loro errori. Il numero onesto è il **Test 5**, scritto dopo le modifiche al motore e prima di guardare i suoi errori: 75,8% → 87,9%. I 4 errori rimasti sono tutti "nessuno" (es. "referente" per "Persona da contattare", "data appuntamento" per "Giorno preferito"), cioè domande per Claude, non azioni sbagliate.
- **L'ECE complessivo sale (0,024 → 0,059) perché ora il motore è un po' prudente** sugli insiemi facili (accuratezza 100% ma confidenza media intorno al 94%). Sulle pagine con vocabolario nuovo, che sono il caso difficile, l'ECE scende molto (Test 5: 0,114 → 0,046). L'errore va nella direzione sicura: qualche domanda in più, nessuna azione sbagliata in più.
- Tutti i casi sono costruiti da me su pagine di prova. Mancano dati da portali reali: le segnalazioni nelle Issues servono proprio a questo.

### Confronto con Jev 1.14 (System One Bench)

Riferimento pubblico: [System One Bench](https://systemonebench.dev) (github alilibx/system-one-bench), che misura i "Sistemi Uno" su domande tipizzate. Gli insiemi di dati sono diversi: il confronto indica un ordine di grandezza, non una classifica.

| | Jev 1.14 (System One Bench) | Motore locale v0.4 (419 casi, questi moduli) |
|---|---|---|
| Accuratezza sulle domande di scelta | 75,7% | 98,6% (Test 5 indipendente: 87,9%) |
| ECE | 8,4% (scelta) · 6,0% (complessivo) | 5,9% (Test 5: 4,6%) |
| AUROC della confidenza | 0,81 | 0,95 |
| Latenza | 136 ms p50 · 175 ms p95 | 1,7 ms p50 · 8,3 ms p95 |
| Costo | 0,028 $ ogni 1.000 chiamate | 0 (locale) |
| Generalizzazione a domini qualsiasi | ampia (modello addestrato) | limitata ai moduli web e al suo vocabolario |

Jev risponde a domande di qualsiasi dominio; questo motore sa fare una cosa sola (abbinare dati a campi di moduli web) e per questo, su quel compito, è più preciso, più veloce e gratuito.

## Altre domande tipizzate

- **Scelta di un'opzione** (menu, gruppo di radio, suggerimenti dell'autocompletamento): stessa softmax, con "nessuno" a 4,2.
- **Pulsante di invio** con `submit: true`: scelta tra i pulsanti del modulo, con priorità ad "Avanti", "Invia", "Conferma" e penalità ad "Annulla" e "Bozza".
- **Estrazione** (`extract`): candidati da coppie etichetta-valore, righe di testo e tabelle. Le conversioni (numero, importo, data, URL) le fa il codice, non il modello; se lo stesso valore arriva da più fonti, le probabilità si sommano. Se nessun candidato è abbastanza probabile, la risposta è "non trovato".
- **Verifica** (`expect`): deterministica, cerca il testo nella pagina.

## Differenze rispetto a Jev

- Jev usa un modello addestrato. Qui ci sono euristiche e un dizionario di sinonimi: zero token e zero latenza di rete, ma una generalizzazione peggiore sui termini mai visti (vedi Test 5).
- Jev valuta più domande in parallelo su un servizio remoto. Qui tutto avviene in pochi millisecondi nel processo locale.
- Uguali: domande tipizzate, opzione "nessuno", confidenza dalla distribuzione, soglie per agire o chiedere, aritmetica nel codice, memoria per sito, parametri segreti, controllo di sicurezza prima di ogni azione con effetti.
