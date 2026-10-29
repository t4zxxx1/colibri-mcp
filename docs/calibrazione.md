# Il motore decisionale di browse_task

Dalla versione 0.2 il browser compatto ha un piccolo motore locale che decide da solo i casi semplici e passa a Claude solo quelli incerti. L'idea viene da Jev (jevai.net): un "Sistema Uno" veloce risponde a domande tipizzate con una confidenza calibrata, e si agisce solo sopra una soglia. Qui non c'è nessun modello addestrato né servizio esterno: sono euristiche in JavaScript che girano nel server locale, con due soli parametri calibrati sui dati. Non costano token e non serve una chiave API.

## Il ciclo di un compito

```
osserva → valuta → decidi → abbina → controllo di sicurezza → agisci e verifica
```

1. **Osserva**: la pagina viene letta come tabella compatta (la stessa di `browse_view`), più le etichette complete, i segnaposto, le opzioni dei menu e i titoli dei gruppi.
2. **Valuta**: per ogni parametro (`"P.IVA": "01234567890"`) il motore pone una domanda di **scelta** tra i campi della pagina, con l'opzione **nessuno**.
3. **Decidi**: dalla distribuzione delle probabilità ricava la confidenza e la confronta con la soglia del profilo scelto.
4. **Abbina**: due parametri sullo stesso campo? Resta il più sicuro, l'altro diventa una domanda.
5. **Controllo di sicurezza**: `!x` (password, carte, OTP, IBAN) mai; `!c` (consensi, invio, elimina, carica file) solo con `confirm: true` dopo l'ok dell'utente; invio bloccato se restano domande, errori o campi obbligatori vuoti.
6. **Agisci e verifica**: compila in ordine di pagina, aspetta i menu dipendenti, sceglie il suggerimento dell'autocompletamento con un'altra domanda di scelta, adatta le date al formato del campo, poi rilegge i valori.

Ciò che il motore non sa decidere torna a Claude come domanda:

```
? "luogo": e605 "Sede di svolgimento" 54% · nessuno 43% · e612 "Argomenti trattati" 1%
rispondi con answers: {"parametro": "ref"} (vengono ricordate per questo sito)
```

La risposta di Claude viene salvata in una **memoria per sito** (`site-memory.json` accanto al profilo del browser): la volta successiva lo stesso parametro sullo stesso sito non genera domande.

## Come si calcola la confidenza

Per ogni campo candidato il motore calcola un punteggio (logit):

| Componente | Peso | Cosa misura |
|---|---|---|
| Somiglianza dell'etichetta | 7 | concetti (dizionario di sinonimi in 6 lingue: "P.IVA" = "Partita IVA" = "USt-IdNr." = "Numéro de TVA"), parole in comune anche con radice diversa, lettere in comune |
| Compatibilità del valore | 2 | un'email in un campo email, una data in un campo data, un'opzione esistente in un menu |
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

T e il logit di "nessuno" sono stati stimati minimizzando la log-verosimiglianza negativa con un piccolo label smoothing (EPS), scelto in base all'errore di calibrazione (ECE). Valori finali: **T = 0,85, nessuno = 4, EPS = 0,01**. Lo script è `npm run calibrate` (`test/calibrate.mjs`).

Quattro insiemi di casi, ognuno con anche casi negativi (parametri che nella pagina non hanno un campo, dove la risposta giusta è "nessuno"):

| Insieme | Pagina | Casi | Ruolo |
|---|---|---|---|
| Addestramento | domanda di contributo (italiano) | 141 | stima di T e "nessuno" |
| Test 1 | registrazione fornitore in inglese, francese, spagnolo, tedesco | 140 | scelta di EPS |
| Test 2 | iscrizione a un corso | 41 | scelta di EPS |
| Test 3 | registro di una lezione | 29 | **misurato una sola volta, a fine sviluppo, senza modifiche successive** |

| Insieme | Accuratezza | ECE | Decisi da solo (balanced) | Precisione delle decisioni autonome |
|---|---|---|---|---|
| Addestramento | 100% | 0,048 | 131 su 141 (92,9%) | 100% |
| Test 1 | 100% | 0,066 | 116 su 140 (82,9%) | 100% |
| Test 2 | 97,6% | 0,063 | 35 su 41 (85,4%) | 100% |
| Test 3 | 75,9% | 0,186 | 16 su 29 (55,2%) | 100% |

Risultati completi: [calibration-results.json](calibration-results.json).

### Come leggere questi numeri

- **Gli errori di Test 1 e Test 2 hanno guidato correzioni** (sinonimi, peso del titolo della sezione, parole generiche come "numero" e "codice"). Per questo li considero insiemi di sviluppo più che di test. Test 3 è stato creato dopo, ed è l'unico numero davvero indipendente.
- **Su Test 3 il motore sbaglia 7 casi su 29, ma in tutti e 7 risponde "nessuno"**: sinonimi che non conosce ("luogo" per "Sede di svolgimento", "formatore" per "Docente", "dalle ore" per "Ora inizio", "foglio firme" per "Allegato registro presenze"). In pratica diventano domande per Claude, non azioni sbagliate. Le decisioni prese da solo sono state giuste in 298 casi su 298, in tutti e quattro gli insiemi.
- **L'ECE di Test 3 (0,186) dice che su pagine con vocabolario nuovo il motore è troppo sicuro di "nessuno"**. Su siti reali con termini di settore ci si deve aspettare più domande del 10-15% visto negli insiemi di sviluppo. La memoria per sito riduce le domande dalla seconda volta in poi.
- Tutti i casi sono costruiti da me su pagine di prova. Mancano dati da portali reali: le segnalazioni nelle Issues servono proprio a questo.

## Altre domande tipizzate

- **Scelta di un'opzione** (menu, gruppo di radio, suggerimenti dell'autocompletamento): stessa softmax, con "nessuno" a 4,2.
- **Pulsante di invio** con `submit: true`: scelta tra i pulsanti del modulo, con priorità ad "Avanti", "Invia", "Conferma" e penalità ad "Annulla" e "Bozza".
- **Estrazione** (`extract`): candidati da coppie etichetta-valore, righe di testo e tabelle. Le conversioni (numero, importo, data, URL) le fa il codice, non il modello; se lo stesso valore arriva da più fonti, le probabilità si sommano. Se nessun candidato è abbastanza probabile, la risposta è "non trovato".
- **Verifica** (`expect`): deterministica, cerca il testo nella pagina.

## Differenze rispetto a Jev

- Jev usa un modello addestrato. Qui ci sono euristiche e un dizionario di sinonimi: zero token e zero latenza di rete, ma una generalizzazione peggiore sui termini mai visti (vedi Test 3).
- Jev valuta più domande in parallelo su un servizio remoto. Qui tutto avviene in pochi millisecondi nel processo locale.
- Uguali: domande tipizzate, opzione "nessuno", confidenza dalla distribuzione, soglie per agire o chiedere, aritmetica nel codice, memoria per sito, parametri segreti, controllo di sicurezza prima di ogni azione con effetti.
