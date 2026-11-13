// Test della funzione di analisi: node test/analyze.test.js
// Estrae le funzioni pure da content.js e le prova su testi di annunci di esempio.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const pick = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
// eslint-disable-next-line no-eval
eval(pick('  const DAY', '  // Dati strutturati') + pick('  // Partita IVA come forma di contratto', '  // ======================================================================\n  // Archivio'));
// eslint-disable-next-line no-eval
eval(pick('  function mergeEntry', '  function importData'));
eval(pick('  const num = t =>', '  const google = '));
eval(pick('  // --- Parole chiave dell', '  // ======================================================================\n  // Interfaccia'));
eval(pick('  const REGISTRY_RE', '  // Sulle pagine dei registri'));
eval(pick('  const PAY_WORD', '  const REVIEWS_PAGE'));
eval(pick('  const KNOCKOUT_RE', '  // Nel modulo di candidatura'));
eval(pick('  function paymentCheck', '  // ======================================================================\n  // Come funziona la candidatura'));

const has = (r, text) => r.reasons.some(([, t]) => t.includes(text));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ', name); } catch (e) { console.error('FAIL ', name, '\n     ', e.message); process.exitCode = 1; }
}
const long = 'x'.repeat(800);

test('LinkedIn: annuncio vecchio, ripubblicato, molti candidati = rischio alto', () => {
  const r = analyze({ header: 'RemoExperts\nAI Generalist\nItalia · Ripubblicata 3 settimane fa · Più di 100 persone hanno cliccato\nRisposte gestite esternamente a LinkedIn\n63,4K USD /yr', body: long }, null);
  assert.strictEqual(r.score, 5);
  assert(has(r, 'Annuncio ripubblicato'));
});

test('LinkedIn: ripubblicato di recente pesa +1', () => {
  const r = analyze({ header: 'Napoli · Ripubblicata 6 giorni fa · 79 persone', body: long }, null);
  assert(has(r, 'ripubblicato di recente'));
});

test('"Attiva Premium per 0 €" non conta come retribuzione', () => {
  const r = analyze({ header: 'Titolo\nPubblicata 2 giorni fa\nAttiva Premium per 0 €', body: long }, null);
  assert(has(r, 'Retribuzione non indicata'));
});

test('Indeed: contratto di collaborazione e partita IVA', () => {
  const r = analyze({ header: 'Titolo\nAzienda\n833 € al mese\nCollaborazione, Contratto con partita IVA', body: 'Descrizione completa della posizione ' + long }, null);
  assert(has(r, 'Contratto di collaborazione'));
  assert(has(r, 'Partita IVA'));
});

test('Il numero di P.IVA dell\'azienda non è un segnale', () => {
  const r = analyze({ header: 'Titolo\n1.500 € al mese', body: long + ' Azienda Srl P.IVA 01234567890' }, null);
  assert(!has(r, 'Partita IVA'));
});

test('Piè di pagina Randstad: "Partita IVA: Randstad Gruppo IVA n." non è un segnale', () => {
  const r = analyze({ header: '', body: long + ' Codice Fiscale n. 12730090151 - N. REA MI-1581244 Partita IVA: Randstad Gruppo IVA n. 10538750968' }, null);
  assert(!has(r, 'Partita IVA'));
});

test('"Lavoro dipendente, no partita IVA" non è un segnale', () => {
  const r = analyze({ header: '', body: long + ' Lavoro dipendente, no partita iva.' }, null);
  assert(!has(r, 'Partita IVA'));
});

test('"Si richiede partita IVA" è un segnale', () => {
  const r = analyze({ header: '', body: long + ' Si richiede partita iva.' }, null);
  assert(has(r, 'Partita IVA'));
});

test('Randstad: infermiere in libera professione è segnalato', () => {
  const r = analyze({ title: 'INFERMIERE IN LIBERA PROFESSIONE', header: '', body: long }, { employmentType: ['CONTRACTOR', 'FULL_TIME'] });
  assert(has(r, 'Lavoro autonomo'));
});

test('Randstad: CONTRACTOR con "tempo determinato" non è lavoro autonomo', () => {
  const r = analyze({ title: 'OPERAIO METALMECCANICO', header: '', body: long + ' Si offre: contratto a tempo determinato iniziale.' }, { employmentType: ['CONTRACTOR', 'FULL_TIME'] });
  assert(!has(r, 'Lavoro autonomo') && !has(r, 'Partita IVA'));
});

test('"non si valutano infermieri in regime di libera professione" non è un segnale', () => {
  const r = analyze({ title: 'Infermiere', header: '', body: long + ' Per questa posizione non si valutano infermieri in regime di libera professione.' }, null);
  assert(!has(r, 'Lavoro autonomo'));
});

test('"Tipologia contrattuale: Libera professione (Partita IVA)" è segnalato', () => {
  const r = analyze({ title: 'Medico cardiologo', header: '', body: long + ' Tipologia contrattuale: Libera professione (Partita IVA). Impegno orario: 20 ore.' }, null);
  assert(has(r, 'Lavoro autonomo') || has(r, 'Partita IVA'));
});

test('"regime di collaborazione in Partita IVA" è segnalato', () => {
  const r = analyze({ title: 'Infermiere in ADI', header: '', body: long + ' contratto a tempo indeterminato oppure un regime di collaborazione in Partita IVA.' }, null);
  assert(has(r, 'Partita IVA'));
});

test('"non è richiesta la partita IVA" non è un segnale', () => {
  const r = analyze({ title: 'Impiegato', header: '', body: long + ' Assunzione diretta, non è richiesta la partita IVA.' }, null);
  assert(!has(r, 'Partita IVA'));
});

test('Randstad: tempo determinato (TEMPORARY) non è lavoro autonomo', () => {
  const r = analyze({ title: 'Addetto magazzino', header: '', body: long + ' Tipologia contrattuale: Tempo Determinato' }, { employmentType: ['TEMPORARY', 'FULL_TIME'] });
  assert(!has(r, 'Lavoro autonomo') && !has(r, 'Partita IVA'));
});

test('Stage segnalato anche da employmentType INTERN', () => {
  const r = analyze({ title: 'Ingegnere gestionale', header: '', body: long }, { employmentType: ['INTERN'] });
  assert(has(r, 'Stage'));
});

test('"approvvigionamento" non è "provvigione"', () => {
  const r = analyze({ title: 'Addetto ufficio acquisti', header: '', body: long + ' Gestione degli approvvigionamenti e pianificazione.' }, null);
  assert(!has(r, 'provvigione'));
});

test('"2 giorni al mese di smart working" non è uno stipendio', () => {
  const r = analyze({ title: 'Impiegato', header: '', body: long + ' Previsti 2 giorni al mese di smart working.' }, null);
  assert(has(r, 'Retribuzione non indicata'));
});

test('"1.400 euro netti al mese" è uno stipendio', () => {
  const r = analyze({ title: 'Impiegato', header: '', body: long + ' Offriamo 1.400 euro netti al mese.' }, null);
  assert(has(r, 'Retribuzione indicata'));
});

test('Importa: per "afseen:" vince la data più vecchia', () => {
  const r = mergeEntry('afseen:x', { first: '2026-11-01' }, { first: '2026-10-01' });
  assert(r.first === '2026-10-01');
});

test('"Stile di lavoro autonomo" non è lavoro autonomo', () => {
  const r = analyze({ title: 'Tecnico service', header: '', body: long + ' Stile di lavoro autonomo e orientato ai risultati.' }, null);
  assert(!has(r, 'Lavoro autonomo'));
});

test('"Possesso di P.IVA" (medico di guardia) è segnalato', () => {
  const r = analyze({ title: 'Medico di guardia', header: '', body: long + ' Iscrizione all\'Albo dei Medici. Possesso di P.IVA.' }, null);
  assert(has(r, 'Partita IVA'));
});

test('Dipendenti: 1.001-5.000 dichiarati e 12 su LinkedIn → segnale', () => {
  const g = employeeGap({ employees: '1.001-5.000', onLinkedIn: '12' });
  assert(g && g.points === 1 && /1001/.test(g.text));
});

test('Dipendenti: 51-200 dichiarati e 60 su LinkedIn → nessun segnale', () => {
  assert(employeeGap({ employees: '51-200', onLinkedIn: '60' }) === null);
});

test('Dipendenti: 51-200 e 5 su LinkedIn → solo informativo', () => {
  const g = employeeGap({ employees: '51-200', onLinkedIn: '5' });
  assert(g && g.points === 0);
});

test('Dipendenti: 2-10 (piccola) → nessun confronto', () => {
  assert(employeeGap({ employees: '2-10', onLinkedIn: '0' }) === null);
});

test('Parole chiave: requisiti di un annuncio amministrativo', () => {
  const ad = 'Descrizione. Requisiti: diploma di ragioneria, conoscenza della partita doppia, ottima conoscenza del pacchetto Office e di Excel, utilizzo di SAP, patente B. Cosa offriamo: contratto a tempo indeterminato.';
  const k = adKeywords(ad);
  assert(k.includes('partita doppia') && k.includes('pacchetto office') && k.includes('patente b') && k.includes('SAP') && k.includes('excel'));
  assert(!k.includes('contratto') && !k.includes('indeterminato'));
});

test('Confronto CV: trova cosa c\'è e cosa manca', () => {
  const ad = 'Requisiti: conoscenza di Excel e SAP, contabilità generale, patente B.';
  const r = compareCv(ad, 'Impiegato amministrativo. Uso quotidiano di Excel. Contabilita generale e fatturazione.');
  assert(r.have.includes('excel') && r.have.includes('contabilità'));
  assert(r.miss.includes('SAP') && r.miss.includes('patente b'));
});

test('Confronto CV: "SAP" non trovato dentro "sapere"', () => {
  const r = compareCv('Requisiti: SAP.', 'Voglia di sapere e imparare.');
  assert(r.miss.includes('SAP'));
});

test('Subito: "Tipo di contratto: Contratto a progetto" è segnalato', () => {
  const r = analyze({ title: 'Operatore', header: 'Oggi alle 17:01\n12.000 €\nLivello\nImpiegato\nTipo di contratto\nContratto a progetto', body: long }, null);
  assert(has(r, 'a progetto'));
});

test('Subito: annuncio di un privato è segnalato', () => {
  const r = analyze({ title: 'Segretaria', header: 'Oggi alle 11:03\n1.000 €', body: long, companyInfo: { privateUser: true } }, null);
  assert(has(r, 'privato'));
});

const AZIENDE_IT = 'NAPOLIWEB SRL\nATTIVA\nSOCIETA\' A RESPONSABILITA\' LIMITATA\nNapoli (NA)\nATECO 62.9\ndal 2000\nP.IVA 07603110631\nREA NA-638510\n€ 156.034\nFatturato 2024\n-30,7%\nVariazione vs 2021\n€ 3.818\nPerdita 2024\n3\nDipendenti\n€ 10.400\nCapitale sociale\n';
const COMPANYREPORTS = 'Office Solution Srl\nPartita IVA\n03489430987\nFatturato\n€ 916.476 (2024)ACQUISTA BILANCIO\nUtile\n€ 56.563 (2024)\nN. Dipendenti\nda 6 a 9\nStato Attività\nAttiva\nFondazione\n06/03/1992\n';

test('Registro: legge la scheda di aziende.it', () => {
  const r = parseRegistry(AZIENDE_IT);
  assert(r.status === 'attiva' && r.employees === '3' && r.revenue === 156034 && r.revenueYear === '2024');
  assert(r.revenueChange === '-30,7' && r.profit === -3818 && r.since === '2000' && r.capital === 10400 && r.piva === '07603110631');
});

test('Registro: legge la scheda di companyreports.it', () => {
  const r = parseRegistry(COMPANYREPORTS);
  assert(r.status === 'attiva' && r.employees === 'da 6 a 9' && r.revenue === 916476 && r.profit === 56563 && r.since === '1992');
  assert(maxEmployees(r.employees) === 9);
});

test('Registro: "IN LIQUIDAZIONE" di un\'altra azienda nell\'elenco non conta', () => {
  const r = parseRegistry('VFD NAPOLI SRL\nATTIVA\n21\nDipendenti\nAcquista visura\nAltre aziende a Napoli\nBRUNO RIVA SRL IN LIQUIDAZIONE\n1-2 milioni\nIN LIQUIDAZIONE\n');
  assert(r.status === 'attiva');
});

test('Registro: azienda inattiva → segnale rosso', () => {
  const r = parseRegistry('Interni Srl\nN. Dipendenti\n2\nStato Attività\nInattiva\n');
  assert(registryCheck(r, '').some(x => x[1] === 'rosso'));
});

test('Registro: "multinazionale" con 3 dipendenti → segnale', () => {
  const r = parseRegistry(AZIENDE_IT);
  assert(registryCheck(r, 'Siamo una multinazionale leader nel settore.').some(x => /multinazionale/.test(x[2])));
});

test('Registro: perdita e fatturato in calo → segnale', () => {
  assert(registryCheck(parseRegistry(AZIENDE_IT), '').some(x => /difficolt/.test(x[2])));
});

test('Registro: tanti requisiti per un\'azienda di 3 persone → tuttofare', () => {
  const req = 'Requisiti:\n' + Array.from({ length: 11 }, (_, i) => '- competenza ' + i).join('\n') + '\nOffriamo: contratto';
  assert(registryCheck(parseRegistry(AZIENDE_IT), req).some(x => /tuttofare/.test(x[2])));
});

test('Nomi azienda: "GMA GROUP S.R.L." e "Gma Group srl" coincidono', () => {
  assert(normCompany('GMA GROUP S.R.L.') === normCompany('Gma Group srl') && normCompany('Gma Group srl') === 'gma group');
});

test('Pagamenti: riconosce ritardi e pagamenti puntuali', () => {
  const r = paymentMentions([
    'Ottima agenzia interinale, attenzione al dipendente stipendio puntuale. Buona selezione offerte.',
    'Ambiente pessimo. Lo stipendio arriva sempre in ritardo di due mesi.',
    'Non pagano gli straordinari e la tredicesima è arretrata.',
    'Pagamenti regolari, mai un ritardo.',
    'Il capo è simpatico.'
  ]);
  assert(r.neg.length === 2 && r.pos.length === 2);
});

test('Pagamenti: "mai in ritardo con lo stipendio" è positivo', () => {
  const r = paymentMentions(['Azienda seria, mai in ritardo con lo stipendio.']);
  assert(r.neg.length === 0);
});

test('Pagamenti: 2 lamentele → rosso', () => {
  assert(paymentCheck({ neg: 2, pos: 5 })[0][1] === 'rosso');
});

test('Stipendio assente: cita l\'obbligo di legge e la formula vaga', () => {
  const r = analyze({ title: 'Impiegato', header: '', body: long + ' Retribuzione commisurata all\'esperienza.' }, null);
  assert(has(r, 'D.Lgs. 96/2026') && has(r, 'formula vaga'));
});

test('Truffa "a compito": guadagni facili mettendo like → scam', () => {
  const r = analyze({ title: 'Lavoro da casa', header: '', body: long + ' Guadagni facili: basta uno smartphone, devi solo mettere mi piace ai video.' }, null);
  assert(r.scam === true && has(r, 'truffe'));
});

test('Documenti e IBAN chiesti nell\'annuncio → scam', () => {
  const r = analyze({ title: 'Addetto', header: '', body: long + ' Inviare copia del documento d\'identità e IBAN per la registrazione.' }, null);
  assert(r.scam === true && has(r, 'documenti'));
});

test('WhatsApp: segnale giallo, non truffa da solo', () => {
  const r = analyze({ title: 'Cameriere', header: '', body: long + ' Inviare CV su WhatsApp al 333 1234567.' }, null);
  assert(has(r, 'WhatsApp') && !r.scam);
});

test('Email personale per candidarsi → segnale', () => {
  const r = analyze({ title: 'Segretaria', header: '', body: long + ' Inviare CV a studio.rossi@gmail.com' }, null);
  assert(has(r, '@gmail'));
});

test('"Formazione gratuita" è un vantaggio, non lavoro non pagato', () => {
  const r = analyze({ title: 'Operatore', header: '', body: long + ' Offriamo formazione gratuita e affiancamento.' }, null);
  assert(!has(r, 'non pagato'));
});

test('"Giornata di prova non retribuita" → segnale rosso', () => {
  const r = analyze({ title: 'Barista', header: '', body: long + ' Prevista giornata di prova non retribuita.' }, null);
  assert(has(r, 'non pagato'));
});

test('Annuncio vetrina: "per future selezioni" → segnale', () => {
  const r = analyze({ title: 'Varie figure', header: '', body: long + ' Raccogliamo candidature per eventuali future selezioni.' }, null);
  assert(has(r, 'per il futuro'));
});

test('Annuncio normale: nessun segnale di truffa o vetrina', () => {
  const r = analyze({ title: 'Impiegato amministrativo', company: 'Rossi Srl', header: '3 giorni fa', body: long + ' Contratto a tempo indeterminato, CCNL Commercio, RAL 26.000 €. Contattaci tramite il modulo.' }, null);
  assert(!r.scam && !has(r, 'WhatsApp') && !has(r, 'futuro') && !has(r, 'anonimi') && has(r, 'CCNL'));
});

test('Azienda non indicata → richiamo al divieto di annunci anonimi', () => {
  const r = analyze({ title: 'Impiegato', company: 'Azienda non indicata', header: '', body: long }, null);
  assert(has(r, 'anonimi'));
});

test('Filtro ATS: requisiti indispensabili e anni minimi', () => {
  const ad = 'Requisiti:\n- Laurea in Economia indispensabile\n- almeno 3 anni di esperienza nel ruolo\n- Conoscenza di SAP\nCosa offriamo: contratto';
  const ko = knockouts(ad);
  assert(ko.some(k => /Laurea/.test(k)) && ko.some(k => /3 anni/.test(k)) && !ko.some(k => /SAP/.test(k)));
});

test('Filtro ATS: Workday + requisiti → rosso; nessun programma né requisiti → grigio', () => {
  const ad = 'Requisiti: patente B obbligatoria, Excel.';
  assert(atsFilter({ kind: 'ats', name: 'Workday' }, ad).level === 'rosso');
  assert(atsFilter(null, 'Cerchiamo persona motivata. Requisiti: Excel.').level === 'grigio');
});

test('Data italiana "05/11/2026" = 5 novembre, non 11 maggio (Gi Group)', () => {
  const d = parseDate('05/11/2026');
  assert(new Date(d).getUTCMonth() === 10 && new Date(d).getUTCDate() === 5);
});

test('Data compatta "20261113T121507" (Manpower)', () => {
  const d = new Date(parseDate('20261113T121507'));
  assert(d.getUTCFullYear() === 2026 && d.getUTCMonth() === 10 && d.getUTCDate() === 13 && d.getUTCHours() === 12);
});

test('Scadenza precedente alla pubblicazione → incoerente (giallo), non "scaduto"', () => {
  const posted = new Date(Date.now() - 8 * 864e5);
  const dd = String(posted.getUTCDate()).padStart(2, '0') + '/' + String(posted.getUTCMonth() + 1).padStart(2, '0') + '/' + posted.getUTCFullYear();
  const r = analyze({ title: 'Mandatario', header: '', body: long }, { datePosted: dd, validThrough: '2026-08-09' });
  assert(has(r, 'incoerenti') && !has(r, 'Scaduto') && r.days < 10);
});

test('Indeed: data interna di 344 giorni → "fantasma" (+3)', () => {
  const r = analyze({ title: 'Impiegato', header: 'Napoli', body: long, pubDays: 344 }, null);
  assert(has(r, 'mesi') && has(r, 'fantasma'));
});

test('Oltre un anno → espresso in anni', () => {
  const r = analyze({ title: 'Impiegato', header: '', body: long, pubDays: 1204 }, null);
  assert(has(r, '3,3 anni'));
});

test('Fascia "€ 500 - € 25000" → troppo larga', () => {
  const r = analyze({ title: 'Stage HR', header: '', body: long + ' Retribuzione: € 500 - € 25000 Annuale' }, null);
  assert(has(r, 'troppo larga'));
});

test('Fascia scritta dentro i dati strutturati (Manpower) → troppo larga', () => {
  const r = analyze({ title: 'Stage HR', header: '', body: long }, { baseSalary: { currency: '€', value: { value: '€ 500 - € 25000 Annuale', unitText: 'Annuale' } } });
  assert(has(r, 'troppo larga'));
});

test('Fascia 24.000 - 28.000 € → nessun segnale', () => {
  const r = analyze({ title: 'Impiegato', header: '', body: long + ' RAL 24.000 - 28.000 €' }, null);
  assert(!has(r, 'troppo larga'));
});

test('Junior che chiede 3 anni di esperienza → incoerente', () => {
  const r = analyze({ title: 'Impiegato amministrativo junior', header: '', body: long + ' Requisiti: almeno 3 anni di esperienza.' }, null);
  assert(has(r, 'almeno 3 anni'));
});

test('"Urgente" ma online da 40 giorni', () => {
  const r = analyze({ title: 'Magazziniere - urgente', header: '', body: long, pubDays: 40 }, null);
  assert(has(r, 'urgente'));
});

test('"Valori spa Agenzia per il lavoro" riconosciuta come agenzia', () => {
  const r = analyze({ title: 'Farmacista', company: 'Valori spa Agenzia per il lavoro', header: '', body: long }, null);
  assert(has(r, 'agenzia'));
});

test('Parole chiave: niente "dell", "QUI", "candidature", "ideale"', () => {
  const k = adKeywords('Requisiti: il candidato ideale dell\'area amministrazione, CLICCA QUI, invia candidature. Conoscenza di SAP e contabilità.');
  assert(!k.some(w => /^(dell|QUI|candidature|ideale)$/i.test(w)) && k.includes('SAP'));
});

test('Truffa: provvigioni e corso a pagamento', () => {
  const r = analyze({ header: '', body: 'Guadagni illimitati! Corso a pagamento di 200 euro. Lavoro a provvigione.' }, null);
  assert(has(r, 'Ti chiedono di pagare'));
  assert(has(r, 'provvigione'));
  assert(!has(r, 'Retribuzione indicata'));
  assert(r.score >= 4);
});

test('Dati strutturati: annuncio scaduto ma online', () => {
  const ld = { datePosted: new Date(Date.now() - 45 * 864e5).toISOString(), validThrough: new Date(Date.now() - 10 * 864e5).toISOString(), baseSalary: { value: 30000 } };
  const r = analyze({ header: '', body: long }, ld);
  assert(has(r, 'Scaduto'));
  assert(has(r, 'Online da circa 45 giorni'));
});

test('Azienda che risponde abbassa il rischio', () => {
  const r = analyze({ header: 'Titolo\nAzienda\n1.400 € al mese\nSpesso risponde entro 1 giorno', body: long }, null);
  assert.strictEqual(r.score, 0);
});

test('Il punteggio non scende sotto zero', () => {
  const r = analyze({ header: 'Pubblicata 1 giorno fa\n2.000 € al mese\nSpesso risponde entro 1 giorno', body: long }, null);
  assert(r.score >= 0);
});

test('Importa: unisce le candidature senza doppioni', () => {
  const m = mergeEntry('af:x', { applied: [{ job: '1' }], replies: 1 }, { applied: [{ job: '1' }, { job: '2' }], replies: 0 });
  assert.strictEqual(m.applied.length, 2);
  assert.strictEqual(m.replies, 1);
});

test('Importa: tiene la verifica più recente', () => {
  const m = mergeEntry('afjob:k', { result: 'found', date: '2026-11-01' }, { result: 'notfound', date: '2026-11-04' });
  assert.strictEqual(m.result, 'notfound');
});

test('LinkedIn: "1 mese fa" senza "Pubblicata" = online da 30 giorni, rosso', () => {
  const r = analyze({ title: 'Cloud Native Support Engineer Junior - Apprendistato', header: 'Kiratech\nCloud Native Support Engineer Junior - Apprendistato\nItalia · 1 mese fa · Più di 100 candidati\nNessuna informazione sulla risposta\nDa remoto\nA tempo pieno\nCandidatura semplice\nSalva', body: long }, null);
  assert(has(r, 'Online da circa 30 giorni'));
  assert(has(r, 'Più di 100 candidati'));
  assert(has(r, 'Retribuzione non indicata'));
  assert(r.score >= 4, 'punteggio ' + r.score);
});

test('LinkedIn: "6 giorni fa" senza prefisso viene letto', () => {
  const r = analyze({ header: 'Best Engage\nJunior Cloud\nRoma · 6 giorni fa · 48 persone\n24K € /yr - 30K € yr\nSalva', body: long }, null);
  assert(has(r, 'Pubblicato da circa 6 giorni'));
  assert(has(r, 'Retribuzione indicata'));
});

test('Agenzia di selezione segnalata', () => {
  const r = analyze({ header: 'Titolo\n2 giorni fa\n30.000 € all\'anno', body: long, companyInfo: { sector: 'Servizi risorse umane' } }, null);
  assert(has(r, 'agenzia'));
});

test('Annuncio che non accetta più candidature', () => {
  const r = analyze({ header: 'Titolo\n3 giorni fa\nNon accetta più candidature', body: long }, null);
  assert(has(r, 'Non accetta più candidature'));
});

test('Subito: "Oggi alle" = annuncio di oggi', () => {
  const r = analyze({ header: '', body: 'OFFERTE DI LAVORO\nOggi alle 17:26\nSocial Media Manager\n' + long }, null);
  assert(has(r, 'Pubblicato da meno di un giorno'));
});

test('Subito: data "12 set alle" = vecchio', () => {
  const r = analyze({ header: '', body: 'OFFERTE DI LAVORO\n12 set alle 10:00\nTitolo\n' + long }, null);
  assert(has(r, 'Online da circa'), JSON.stringify(r.reasons));
});

test('Stipendio estratto dal testo', () => {
  const r = analyze({ header: 'Titolo\nPubblicata 2 giorni fa\n24K € /yr - 30K € yr', body: long }, null);
  assert(r.salary.includes('24K'), r.salary);
});

console.log(`\n${passed} test superati`);
