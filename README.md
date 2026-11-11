# Annunci Fantasma

Estensione per browser (Chrome, Brave, Edge, Firefox) che ti aiuta a distinguere gli annunci di lavoro veri da quelli "fantasma" o poco seri.
Su ogni annuncio mostra un **semaforo di rischio** con i motivi, un **diario personale** delle candidature e una **verifica sul sito dell'azienda**.

Non è un verdetto: segnala indizi, non accusa nessuno. Legge solo la pagina che stai guardando e non invia dati a nessun server: diario e verifiche restano nel tuo browser (`chrome.storage.local`).

Versione: 2.1.0 (in prova)

## Scarica

- **Chrome, Brave, Edge, Opera, Vivaldi**: [annunci-fantasma-2.1.0-chrome-brave-edge.zip](https://github.com/Dmitrij-Anatolievic/annunci-fantasma/raw/main/download/annunci-fantasma-2.1.0-chrome-brave-edge.zip)
- **Firefox**: [annunci-fantasma-2.1.0-firefox.zip](https://github.com/Dmitrij-Anatolievic/annunci-fantasma/raw/main/download/annunci-fantasma-2.1.0-firefox.zip)

Come installarla è spiegato più sotto, in [Installazione](#installazione). Hai trovato un errore? Apri una segnalazione in [Issues](https://github.com/Dmitrij-Anatolievic/annunci-fantasma/issues) con il link dell'annuncio e uno screenshot.

## Da sapere prima di provarla

- **È una versione di prova.** Il semaforo segnala indizi, non dà sentenze: un annuncio rosso non è per forza una truffa, uno verde non è per forza serio. Leggi sempre i motivi.
- **Chrome, Brave, Edge:** per gli aggiornamenti estrai il nuovo zip **sempre nella stessa cartella** (sovrascrivi i file) e premi "Ricarica" nella pagina delle estensioni. Se cambi cartella, il browser la tratta come un'estensione nuova e il diario delle candidature riparte da zero.
- **Firefox:** l'estensione resta attiva solo fino alla chiusura del browser; alla riapertura va caricata di nuovo. Per renderla permanente deve essere firmata da Mozilla (è gratis): lo faremo quando la versione sarà stabile.
- **Privacy:** l'estensione legge solo la pagina che stai guardando e non invia dati a nessuno. Diario, verifiche, stipendi visti e il testo del tuo CV restano nel tuo browser.

## Cosa ti dice su ogni annuncio

- **Semaforo di rischio** con i motivi: età dell'annuncio, ripubblicazioni, candidati, retribuzione, chi pubblica (azienda o agenzia), condizioni poco serie (partita IVA o libera professione, provvigioni, richieste di soldi, prestazione occasionale, stage senza rimborso).
- **L'azienda**: dipendenti, persone su LinkedIn, follower, settore e valutazione, quando il sito li mostra; confronto tra dipendenti dichiarati e persone su LinkedIn; più ricerche con un clic: *Dipendenti e fatturato ufficiali*, *Recensioni*, *Reddit*, *Trustpilot*, *Notizie* (assunzioni, licenziamenti, crisi).
- **Stipendio**: quello dell'annuncio e quelli che hai già visto per lo stesso ruolo (lo storico cresce mentre navighi), più la ricerca dello stipendio medio del ruolo.
- **Dati ufficiali dell'azienda**: dal pulsante *Dipendenti e fatturato ufficiali* apri la scheda dell'azienda su aziende.it, companyreports.it o ufficiocamerale.it. L'estensione legge quello che la pagina mostra gratis (stato, dipendenti, fatturato, utile o perdita, anno di nascita) e lo confronta con l'annuncio: se un'azienda di 3 persone si presenta come "multinazionale", se è in liquidazione, se chiede mille competenze diverse come se cercasse un tuttofare, il riquadro te lo dice. L'estensione non interroga quei siti da sola: legge solo la pagina che apri tu.
- **Pagano puntuali?**: apre le recensioni dei dipendenti su stipendio e retribuzione (su Indeed già filtrate). Il riquadro conta quante parlano di stipendi in ritardo, arretrati o non pagati e quante di pagamenti puntuali, e lo riporta su tutti gli annunci di quell'azienda. Legge solo la pagina che apri tu; su Indeed il testo completo delle recensioni è visibile solo a chi ne ha scritta una, quindi conta la parte visibile.
- **Come ti candidi**: con quale programma l'azienda raccoglie le candidature (gli "ATS": Workday, Greenhouse, InRecruiting…), spiegato in parole semplici: serve un account? il modulo è lungo? cosa conviene fare? Più una spiegazione di cos'è un ATS e di come scrivere un CV che si legga bene.
- **Il tuo CV e questo annuncio**: incolli una volta il testo del tuo CV (resta solo nel tuo browser) e su ogni annuncio vedi quali parole chiave dei requisiti hai già e quali ti mancano. Se una competenza la hai davvero, scrivila con le stesse parole dell'annuncio; se non la hai, non aggiungerla.
- **Diario** delle candidature e **verifica** sul sito dell'azienda.
- **Numero sull'icona** con il punteggio, colorato come il semaforo.

Cosa non può fare, per onestà: bilanci, licenziamenti, recensioni e stipendi di 5 anni fa non sono dati pubblici e gratuiti che un'estensione possa leggere da sola. Per questo l'estensione ti porta alla ricerca giusta con un clic invece di inventare numeri.

## Dove funziona

| Dove | Come |
| --- | --- |
| LinkedIn, Indeed | Automatico |
| Subito, Jooble e qualsiasi pagina annuncio con dati schema.org (es. Randstad) | Automatico sulle pagine del singolo annuncio |
| Glassdoor, Bakeca, Careerjet, Jobrapido, Talent.com, Welcome to the Jungle, Adecco, Manpower, Gi Group, Umana, Openjobmetis | Automatico se la pagina ha i dati schema.org, altrimenti clic sull'icona |
| Pagine carriere aziendali: Greenhouse, Lever, Workday, SmartRecruiters, Teamtailor, Recruitee, InRecruiting, Personio | Come sopra |
| Qualsiasi altro sito | Clic sull'icona |

## Browser

| Browser | Pacchetto |
| --- | --- |
| Chrome, Brave, Edge, Opera, Vivaldi | `annunci-fantasma-<versione>-chrome-brave-edge.zip` |
| Firefox (121 o successivo) | `annunci-fantasma-<versione>-firefox.zip` |

Safari non è supportato: richiede un account sviluppatore Apple a pagamento.

## Installazione

### Chrome, Brave, Edge, Opera, Vivaldi

1. Scarica ed estrai lo zip in una cartella. Per gli aggiornamenti usa **sempre la stessa cartella**: se cambi cartella, Chrome assegna un nuovo ID e il diario riparte da zero.
2. In Chrome apri `chrome://extensions` e attiva **Modalità sviluppatore**.
3. Clicca **Carica estensione non pacchettizzata** e scegli la cartella.
4. Fissa l'icona nella barra degli strumenti (simbolo del puzzle → puntina).

Se l'analisi non parte da sola: **Dettagli** dell'estensione → **Accesso ai siti** → "Sui siti specifici" con i siti attivi.

### Firefox

1. Apri `about:debugging#/runtime/this-firefox`.
2. **Carica componente aggiuntivo temporaneo** e scegli il file `manifest.json` dentro la cartella estratta dallo zip Firefox.
3. In Firefox un'estensione caricata così resta attiva fino alla chiusura del browser. Per installarla in modo permanente va firmata gratuitamente da Mozilla (addons.mozilla.org, anche come estensione non pubblica).
4. Se l'analisi non parte: menu Estensioni → Annunci Fantasma → **Consenti sempre** sui siti di lavoro.

### Aggiornare

Dalla versione 2.1.0 l'estensione controlla da sola se c'è una versione nuova e lo scrive in cima al riquadro. Nella sezione **Aggiornamenti** del riquadro:

- **Chrome, Brave, Edge**: premi **Aggiorna** (lo zip finisce nella cartella Download), estrailo nella cartella dove hai installato l'estensione sovrascrivendo i file, poi premi **Ricarica estensione** e ricarica la pagina. Non serve disinstallare: diario e dati restano.
- **Firefox**: premi **Aggiorna** e carica il file scaricato da `about:debugging` come la prima volta.

Un aggiornamento del tutto automatico non è possibile finché l'estensione non sta in uno store: Chrome, su Windows e Mac, accetta estensioni fuori dal Chrome Web Store solo in modalità sviluppatore, e queste non si aggiornano da sole; Firefox le aggiorna da solo solo se sono firmate da Mozilla.

## Segnali e punteggio

| Segnale | Punti |
| --- | --- |
| Online da 30 giorni o più (anche "1 mese fa") | +2 |
| Online da 14 a 29 giorni | +1 |
| Annuncio ripubblicato (+1 se meno di 14 giorni fa) | +2 |
| Non accetta più candidature | +3 |
| Scaduto secondo i dati dell'annuncio ma ancora online | +2 |
| Più di 100 candidati e aperto da più di 14 giorni | +1 |
| Retribuzione non indicata (obbligatoria dal 7 giugno 2026, D.Lgs. 96/2026) | +1 |
| Candidatura gestita fuori dal sito | +1 |
| Contratto di collaborazione invece che da dipendente | +1 |
| Pubblicato da agenzia o società di selezione (azienda finale non indicata) | +1 |
| Stage o tirocinio senza rimborso indicato | +1 |
| Partita IVA richiesta o tra le forme di contratto | +2 |
| Lavoro autonomo ("libera professione", "libero professionista") | +2 |
| L'hai già visto giorni fa e ora la data risulta nuova (annuncio rinfrescato) | +2 |
| Dichiara almeno 200 dipendenti ma meno del 5% è su LinkedIn | +1 |
| Dati ufficiali: azienda non attiva (in liquidazione, cessata…) | +3 |
| Dati ufficiali: si presenta come "multinazionale"/"leader" con meno di 10 dipendenti | +1 |
| Dati ufficiali: 10 o più requisiti diversi per un'azienda con meno di 10 dipendenti (possibile tuttofare) | +1 |
| Dati ufficiali: perdita e fatturato in calo | +1 |
| Annuncio di un privato su Subito | +1 |
| Guadagni facili o lavoretti "a compito" (possibile truffa) | +2 |
| Documenti o dati bancari chiesti già nell'annuncio (possibile truffa) | +2 |
| Prova o periodo di lavoro non pagato | +2 |
| Annuncio "vetrina": raccolgono curriculum per il futuro | +2 |
| Ti fa passare su WhatsApp o Telegram | +1 |
| Candidatura a un'email personale (@gmail ecc.) | +1 |
| Annuncio anonimo (vietato dall'art. 9 D.Lgs. 276/2003) | +1 |
| Recensioni: 2 o più parlano di stipendi in ritardo o non pagati (una sola: +1) | +2 |
| Compenso a provvigione o "guadagni illimitati" | +2 |
| Ti chiedono di pagare (corso, kit, iscrizione) | +3 |
| Prestazione occasionale o ritenuta d'acconto | +1 |
| Descrizione molto scarna | +1 |
| L'azienda risponde spesso ai candidati | −1 |
| L'azienda sta valutando attivamente le candidature (LinkedIn) | −1 |
| 3 o più tue candidature all'azienda senza risposta (diario) | +2 |
| Annuncio NON trovato sul sito dell'azienda (verifica tua) | +2 |
| Annuncio trovato sul sito dell'azienda (verifica tua) | −1 |
| Annuncio promosso | 0 (solo informativo) |

Semaforo: 0–1 verde (rischio basso), 2–3 giallo (medio), 4 o più rosso (alto).

## Diario

- **Mi sono candidato**: segna la candidatura per quell'annuncio (una volta sola).
- **Mi hanno risposto**: aggiunge una risposta ricevuta da quell'azienda.

## Esporta e importa i tuoi dati

- **Esporta** scarica un file `annunci-fantasma-AAAA-MM-GG.json` con diario e verifiche: tienilo come copia di sicurezza o per passare a un altro computer.
- **Importa** carica quel file e lo **unisce** ai dati che hai già, senza cancellare niente: per le candidature tiene tutte quelle distinte, per le verifiche tiene la più recente.

## Verifica sul sito dell'azienda

1. **Cerca sul web** apre una ricerca Google del titolo e dell'azienda fuori da LinkedIn e Indeed.
2. Guardi i risultati e segni **Trovato** o **Non trovato**.
3. L'esito resta salvato per quell'annuncio e cambia il punteggio.

La verifica è manuale di proposito: molte pagine carriere non si leggono in modo affidabile con un programma, così l'esito lo decidi tu.

## Permessi

- `storage`: salvare diario e verifiche nel browser.
- `activeTab` e `scripting`: analizzare la pagina **solo quando clicchi l'icona**, solo in quella scheda.

## Sviluppo

```
node test/analyze.test.js   # test automatici
./build.sh                  # crea i pacchetti in dist/
```

## Limiti noti

- I pesi dei segnali sono scelti a mano e vanno tarati con l'uso.
- Se un sito cambia la struttura della pagina, il riconoscimento può smettere di funzionare.
- Indeed Italia non mostra la data di pubblicazione: lì il segnale di età spesso manca.
- Indeed a volte mostra una verifica anti-robot ("Ci siamo quasi…"): finché non la superi, l'annuncio non viene analizzato.

## Licenza

MIT
