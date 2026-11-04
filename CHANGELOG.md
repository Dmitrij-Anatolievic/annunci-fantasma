# Changelog

## 1.2.0 — 2026-11-04

- Nuovo: confronto tra i dipendenti dichiarati dall'azienda e le persone che su LinkedIn dicono di lavorarci. Se sono molto meno, il riquadro lo segnala.
- Nuovi pulsanti: Reddit (discussioni su colloqui, stipendi, lamentele), Trustpilot, recensioni Indeed/Glassdoor, dipendenti e fatturato ufficiali (aziende.it, companyreports.it, ufficiocamerale.it).
- Stipendio dai dati strutturati scritto in italiano (es. "30 € all'ora").

## 1.1.1 — 2026-11-04

- Corretto: falso allarme "Partita IVA" su Randstad e altri siti. Ora scatta solo se la partita IVA è chiesta come forma di contratto (es. "collaborazione con partita IVA", "richiesta P.IVA", "regime forfettario"), non per il numero di partita IVA dell'azienda nel piè di pagina.
- Il testo legale a fondo pagina (Registro Imprese, Cap. Soc., Sede legale, ©) non viene più analizzato.
- Il pannello dell'estensione non viene più letto come parte dell'annuncio.
- Sui siti con dati strutturati (schema.org) la descrizione ufficiale dell'offerta ha la precedenza.
- Nuovo: segnala il lavoro autonomo anche quando l'annuncio non scrive "partita IVA" ma "libera professione", "libero professionista" o "lavoro autonomo".
- Le frasi negate non fanno più scattare allarmi ("non si valutano liberi professionisti", "no partita IVA", "non è richiesta la partita IVA").
- Corretto: "approvvigionamento" veniva scambiato per "provvigione".
- Corretto: "2 giorni al mese di smart working" veniva scambiato per uno stipendio.
- Nuovo: l'estensione ricorda quando hai visto un annuncio la prima volta; se torna con una data "nuova", ti avvisa che è stato rinfrescato.
- Stage riconosciuto anche dai dati strutturati (INTERN). Il campo CONTRACTOR invece è ignorato: Randstad lo usa anche per contratti a tempo determinato.

## 1.1.0 — 2026-11-04
- LinkedIn: legge le date senza "Pubblicata" ("1 mese fa", "6 giorni fa", "2 anni fa") e il nuovo formato "Più di 100 candidati". Soglie: 14 giorni +1, 30 giorni +2.
- LinkedIn: intestazione trovata a partire dal titolo dell'annuncio aperto (niente più dati presi dalla lista a sinistra).
- Indeed: funziona anche sulla pagina del singolo annuncio (viewjob).
- Scheda azienda: dipendenti, membri LinkedIn, follower, settore, valutazione Indeed; ricerche con un clic per bilanci, recensioni e notizie.
- Stipendio: storico locale degli stipendi visti per lo stesso ruolo e ricerca dello stipendio medio.
- Nuovi segnali: agenzia di selezione, "non accetta più candidature", stage senza rimborso, valutazione attiva delle candidature.
- Attivazione automatica sui principali portali e piattaforme carriere; date tipo Subito ("Oggi alle", "3 nov alle").
- Versione per Firefox; un solo pacchetto per Chrome, Brave, Edge, Opera e Vivaldi.

## 1.0.0 — 2026-11-04
- Icone dell'estensione e punteggio mostrato sull'icona (badge).
- Riconoscimento LinkedIn più robusto: funziona sia nella lista risultati sia nella pagina del singolo annuncio; scarta il riquadro Premium; aspetta che il dettaglio sia aggiornato quando cambi annuncio.
- Lo stato "ridotto" del riquadro viene ricordato.
- Errori interni non bloccano più l'estensione.
- Test automatici (`node test/analyze.test.js`), informativa privacy.

## 0.4.1
- Azienda e titolo riconosciuti sulle pagine carriere tipo Greenhouse.

## 0.4.0
- Esporta / importa diario e verifiche (file JSON, unione senza perdite).

## 0.3.0
- Indeed automatico; qualsiasi altro sito con un clic sull'icona; lettura dei dati schema.org/JobPosting.
- Segnali di condizioni poco serie: partita IVA, provvigioni, richieste di pagamento, prestazione occasionale, descrizione scarna.

## 0.2.0
- Verifica manuale sul sito dell'azienda.

## 0.1.x
- Primo prototipo per LinkedIn: semaforo e diario delle candidature.
