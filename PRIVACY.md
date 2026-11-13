# Informativa sulla privacy — Annunci Fantasma

Annunci Fantasma **non raccoglie, non trasmette e non vende** dati personali.

- **Cosa legge:** solo il testo della pagina dell'annuncio che stai guardando, su LinkedIn e Indeed in automatico, su altri siti solo quando clicchi l'icona.
- **Cosa salva:** il diario delle candidature (azienda, identificativo dell'annuncio, data) e l'esito delle tue verifiche. Tutto in `chrome.storage.local`, cioè solo nel tuo browser.
- **Cosa invia:** niente. L'estensione non contatta alcun server. Il pulsante "Cerca sul web" apre una normale ricerca Google in una nuova scheda, che fai tu.
- **Esportazione:** il file JSON lo crei tu, quando vuoi, e resta sul tuo computer.
- **Cancellazione:** rimuovendo l'estensione da Chrome vengono cancellati anche i suoi dati.

Contatto: tramite la pagina "Issues" del repository del progetto.

## Controllo degli aggiornamenti

Dalla versione 2.1.0 l'estensione legge, al massimo ogni 12 ore, il file pubblico `version.json` del progetto su GitHub (raw.githubusercontent.com) per sapere qual è l'ultima versione. La richiesta non contiene dati tuoi. Il permesso "downloads" serve solo a scaricare l'aggiornamento quando premi **Aggiorna**: i file vengono scritti esclusivamente nella cartella `Download/annunci-fantasma` (o `annunci-fantasma-firefox`) e le voci vengono poi tolte dall'elenco dei download del browser.
