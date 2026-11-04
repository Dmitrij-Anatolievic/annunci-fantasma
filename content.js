// Annunci Fantasma — v1.2.0
// Automatico su LinkedIn, Indeed e sui principali portali di lavoro e pagine carriere;
// su qualsiasi altro sito parte quando clicchi l'icona dell'estensione.
// Legge solo la pagina che stai guardando. Non invia dati a nessun server:
// diario, verifiche e stipendi visti restano nel tuo browser (storage.local).

(() => {
  'use strict';

  // Già caricato (es. clic sull'icona dove lo script è già attivo): background.js ha già chiamato __AF_FORCE
  if (window.__AF_LOADED) return;
  window.__AF_LOADED = true;

  const PANEL_ID = 'af-panel';
  let lastKey = '';
  let minimized = false;
  let retryKey = '';
  let retries = 0;

  window.__AF_FORCE = () => { window.__AF_MANUAL = true; lastKey = ''; tick(); };

  // Lo stato "ridotto/espanso" del riquadro viene ricordato
  try { chrome.storage.local.get('afui', d => { minimized = !!(d && d.afui && d.afui.minimized); }); } catch (e) { /* ignora */ }

  // ======================================================================
  // Utilità comuni
  // ======================================================================

  const DAY = 86400000;

  // "6 giorni fa", "1 mese fa", "Ripubblicata 17 ore fa", "Posted 3 weeks ago", "un mese fa"
  const AGE_RE = /(Ripubblicat[ao]\s+|Pubblicat[ao]\s+|Reposted\s+|Posted\s+|Attivo\s+|Active\s+)?(\d+|un[ao]?|an?)\s+(minut[oi]|minutes?|or[ae]|hours?|giorn[oi]|days?|settiman[ae]|weeks?|mes[ei]|months?|ann[oi]|years?)\s+(fa|ago)\b/i;

  function unitDays(u) {
    u = u.toLowerCase();
    if (/^minut/.test(u)) return 1 / 1440;
    if (/^(ora|ore|hour)/.test(u)) return 1 / 24;
    if (/^(giorn|day)/.test(u)) return 1;
    if (/^(settiman|week)/.test(u)) return 7;
    if (/^(mes|month)/.test(u)) return 30;
    if (/^(ann|year)/.test(u)) return 365;
    return null;
  }

  function lines(text) {
    return (text || '').split('\n').map(s => s.trim()).filter(Boolean);
  }

  // Dati strutturati schema.org/JobPosting (li usano molti portali e quasi tutti i siti carriere aziendali)
  function readJobPostingLD() {
    const found = [];
    const visit = o => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(visit); return; }
      const t = o['@type'];
      if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) found.push(o);
      if (o['@graph']) visit(o['@graph']);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(s.textContent)); } catch (e) { /* JSON non valido: ignora */ }
    }
    return found[0] || null;
  }

  // Primo nodo di testo che coincide esattamente con un testo dato (più veloce che scorrere tutti gli elementi)
  function findTextNodes(text, max = 10) {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && out.length < max) {
      if (n.nodeValue.trim() === text) out.push(n.parentElement);
    }
    return out;
  }

  function findShortText(re) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = n.nodeValue.trim();
      if (t.length < 60 && re.test(t)) return n.parentElement;
    }
    return null;
  }

  // Sale finché il contenitore non ha almeno minLen caratteri
  function growTo(el, minLen, maxSteps = 8) {
    for (let i = 0; el && i < maxSteps; i++, el = el.parentElement) {
      if ((el.innerText || '').length >= minLen) return el;
    }
    return null;
  }

  // ======================================================================
  // Adattatori per sito: ognuno sa trovare annuncio, azienda e titolo
  // ======================================================================

  const linkedin = {
    name: 'LinkedIn',
    auto: true,
    test: () => location.hostname.endsWith('linkedin.com') && location.pathname.startsWith('/jobs'),
    key() {
      const u = new URL(location.href);
      return u.searchParams.get('currentJobId') || (location.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1] || '';
    },
    read() {
      // La scheda del browser è "Titolo | Azienda | LinkedIn" e si aggiorna con l'annuncio aperto
      const parts = document.title.split(' | ');
      if (parts.length < 3 || parts[parts.length - 1].trim() !== 'LinkedIn') return null;
      const title = parts[0].trim();
      const company = parts[parts.length - 2].trim();

      // Intestazione dell'annuncio: il contenitore più piccolo che ha titolo, data e pulsante Salva
      let card = null;
      let cardLen = Infinity;
      for (const t of findTextNodes(title, 12)) {
        let e = t;
        for (let i = 0; e && i < 12; i++, e = e.parentElement) {
          const tx = e.innerText || '';
          if (tx.length > 3000) break;
          if (AGE_RE.test(tx) && /\b(Salva|Salvato|Save|Saved)\b/.test(tx)) {
            if (tx.length < cardLen) { card = e; cardLen = tx.length; }
            break;
          }
        }
      }
      if (!card) return null;

      let header = card.innerText || '';
      const cut = header.search(/Usa l.IA per valutare|Il tuo livello di corrispondenza|Mostra dettagli corrispondenza|Your job match|Premium/i);
      if (cut > 0) header = header.slice(0, cut);

      // Descrizione: sezione "Informazioni sull'offerta di lavoro"
      const aboutEl = findShortText(/^(Informazioni sull.offerta di lavoro|About the job)$/i);
      const bodyEl = aboutEl ? growTo(aboutEl, 300) : null;
      const body = bodyEl ? (bodyEl.innerText || '').slice(0, 20000) : '';

      // Sezione "Informazioni sull'azienda": dipendenti, settore, follower
      const compEl = findShortText(/^(Informazioni sull.azienda|About the company)$/i);
      const compBox = compEl ? growTo(compEl, 150) : null;
      const companyInfo = compBox ? parseLinkedInCompany(compBox.innerText || '') : null;

      return { company, title, header, body, companyInfo };
    }
  };

  function parseLinkedInCompany(text) {
    const l = lines(text);
    const info = { raw: text.slice(0, 1500) };
    const emp = text.match(/([\d.]+\s*-\s*[\d.]+|[\d.]+\+?)\s+(dipendenti|employees)/i);
    if (emp) info.employees = emp[1].replace(/\s+/g, '');
    const onLi = text.match(/([\d.]+)\s+(su LinkedIn|on LinkedIn)/i);
    if (onLi) info.onLinkedIn = onLi[1];
    const fol = text.match(/([\d.]+)\s+follower/i);
    if (fol) info.followers = fol[1];
    const dotIdx = l.indexOf('•');
    if (dotIdx > 0 && !/follower|segui|follow/i.test(l[dotIdx - 1])) info.sector = l[dotIdx - 1];
    return info;
  }

  const indeed = {
    name: 'Indeed',
    auto: true,
    test: () => /(^|\.)indeed\.com$/.test(location.hostname),
    key() {
      const u = new URL(location.href);
      return u.searchParams.get('vjk') || u.searchParams.get('jk') || '';
    },
    read() {
      const root = document.querySelector('#jobsearch-ViewjobPaneWrapper') ||
        document.querySelector('.jobsearch-RightPane') ||
        document.querySelector('#viewJobSSRRoot') ||
        document.body;
      const full = root.innerText || '';
      const L = lines(full);

      // Azienda: link alla pagina aziendale di Indeed (/cmp/), altrimenti la riga dopo il titolo
      const cmpEl = root.querySelector('[data-testid="inlineHeader-companyName"] a, [data-testid="inlineHeader-companyName"], a[href*="/cmp/"]');
      let company = cmpEl ? lines(cmpEl.textContent)[0] || '' : '';
      company = company.replace(/\s*(\(.*?\)|[↗↗]).*$/, '').trim();

      let ci = company ? L.indexOf(company) : -1;
      if (ci < 0 && company) ci = L.findIndex(x => x.startsWith(company));
      let title = '';
      if (ci > 0) title = L[ci - 1];
      if (!title) {
        const hl = L.filter(x => !/^(Torna ai risultati|Job Post Details|Dettagli annuncio)/i.test(x) && x !== '-');
        title = hl[0] || '';
        if (!company) company = hl[1] || '';
      }
      if (!title) return null;

      const DESC_RE = /Descrizione completa della posizione|Full job description/i;
      const t0 = full.indexOf(title);
      let idx = full.search(DESC_RE);
      if (idx < 0) {
        const a = full.search(/Candidati ora|Apply now|Candidati facilmente|Candidatura semplice/i);
        idx = a > 0 ? a + 400 : -1;
      }
      if (idx < 0) return null; // dettaglio non ancora caricato
      const header = full.slice(Math.max(0, t0), idx);
      const body = full.slice(idx, idx + 20000);

      const companyInfo = {};
      const rating = header.match(/([\d][,.]\d)\s*(su 5|out of 5)/i);
      if (rating) companyInfo.rating = rating[1].replace(',', '.') + '/5 su Indeed';
      const cmpLink = root.querySelector('a[href*="/cmp/"]');
      if (cmpLink) companyInfo.reviewsUrl = cmpLink.href.split('?')[0].replace(/\/$/, '') + '/reviews';
      return { company, title, header, body, companyInfo };
    }
  };

  // Portali di lavoro e piattaforme di selezione: analisi automatica sulle pagine di un singolo annuncio
  const PORTALS = [
    // portali (l'azienda va letta dall'annuncio)
    { re: /(^|\.)glassdoor\.[a-z.]+$/, name: 'Glassdoor', kind: 'portale' },
    { re: /(^|\.)subito\.it$/, name: 'Subito', kind: 'portale', detail: /^\/offerte-lavoro\/.+-\d+\.htm$/, company: 'a[href*="/utente/"]' },
    { re: /(^|\.)bakeca\.it$/, name: 'Bakeca', kind: 'portale' },
    { re: /(^|\.)jooble\.org$/, name: 'Jooble', kind: 'portale', detail: /^\/desc\// },
    { re: /(^|\.)careerjet\.it$/, name: 'Careerjet', kind: 'portale' },
    { re: /(^|\.)jobrapido\.com$/, name: 'Jobrapido', kind: 'portale' },
    { re: /(^|\.)talent\.com$/, name: 'Talent.com', kind: 'portale' },
    { re: /(^|\.)welcometothejungle\.com$/, name: 'Welcome to the Jungle', kind: 'portale' },
    { re: /(^|\.)randstad\.it$/, name: 'Randstad', kind: 'agenzia' },
    { re: /(^|\.)adecco\.it$/, name: 'Adecco', kind: 'agenzia' },
    { re: /(^|\.)manpower\.it$/, name: 'Manpower', kind: 'agenzia' },
    { re: /(^|\.)gigroup\.it$/, name: 'Gi Group', kind: 'agenzia' },
    { re: /(^|\.)umana\.it$/, name: 'Umana', kind: 'agenzia' },
    { re: /(^|\.)openjobmetis\.it$/, name: 'Openjobmetis', kind: 'agenzia' },
    // piattaforme carriere usate dalle aziende (l'azienda è chi pubblica)
    { re: /(^|\.)greenhouse\.io$/, name: 'Greenhouse', kind: 'ats' },
    { re: /(^|\.)lever\.co$/, name: 'Lever', kind: 'ats' },
    { re: /(^|\.)myworkdayjobs\.com$/, name: 'Workday', kind: 'ats' },
    { re: /(^|\.)smartrecruiters\.com$/, name: 'SmartRecruiters', kind: 'ats' },
    { re: /(^|\.)teamtailor\.com$/, name: 'Teamtailor', kind: 'ats' },
    { re: /(^|\.)recruitee\.com$/, name: 'Recruitee', kind: 'ats' },
    { re: /(^|\.)intervieweb\.it$/, name: 'InRecruiting', kind: 'ats' },
    { re: /(^|\.)personio\.(de|com|it)$/, name: 'Personio', kind: 'ats' }
  ];

  function portalFor(host) { return PORTALS.find(p => p.re.test(host)) || null; }

  // Pagina di un singolo annuncio? (evita di analizzare le liste di risultati e le home page)
  function looksLikeJobPage(text, portal) {
    if (readJobPostingLD()) return true;
    if (portal && portal.detail) return portal.detail.test(location.pathname) && text.length > 300;
    if (portal) return false; // portale senza schema riconosciuto: solo con il clic sull'icona
    const path = location.pathname + location.search;
    if (!/(job|jobs|lavoro|offert|annunc|vacanc|posizion|career|carriere|position|opening)/i.test(path)) return false;
    if (text.length < 700) return false;
    if (!/(requisiti|responsabilit|mansioni|cosa offriamo|offriamo|qualifications|requirements|responsibilities|we offer|candidati|apply)/i.test(text)) return false;
    const ages = text.match(new RegExp(AGE_RE.source, 'gi')) || [];
    return ages.length <= 4; // tante date diverse = lista di annunci
  }

  // Toglie il piè di pagina legale (P.IVA, capitale sociale, registro imprese...) che non fa parte dell'annuncio
  function stripFooter(text) {
    const i = text.search(/Iscr(\.|izione)\s+(al\s+)?Registro Imprese|Cap(\.|itale)\s+Soc(\.|iale)|Codice Fiscale\s+(n\.|e)|N\.\s*REA|Sede legale|©\s*\d{4}|Copyright\s+\d{4}/i);
    return i > 300 ? text.slice(0, i) : text;
  }

  function htmlToText(html) {
    // DOMParser non esegue script né carica immagini: sicuro anche con HTML della pagina
    const doc = new DOMParser().parseFromString(String(html).replace(/<(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '$&\n'), 'text/html');
    return (doc.body && doc.body.textContent) || '';
  }

  function genericRead(portal) {
    const root = document.querySelector('main') || document.querySelector('article') || document.body;
    const text = stripFooter(root.innerText || '');
    if (!window.__AF_MANUAL && !looksLikeJobPage(text, portal)) return null;
    const ld = readJobPostingLD();
    const ga = document.title.match(/^(?:Job Application for|Candidatura per)\s+(.+?)\s+(?:at|presso)\s+(.+)$/i);
    const og = (document.querySelector('meta[property="og:site_name"]') || {}).content;
    const sel = portal && portal.company ? document.querySelector(portal.company) : null;
    let company = (ld && ld.hiringOrganization && (ld.hiringOrganization.name || ld.hiringOrganization)) || (ga && ga[2]) ||
      (sel ? (sel.textContent || '').trim() : '');
    if (!company && portal && portal.kind === 'ats') {
      company = og || location.hostname.split('.')[0];
    }
    if (!company && !portal) company = og || location.hostname.replace(/^www\./, '');
    if (!company) company = 'Azienda non indicata';
    const title = (ld && ld.title) || (ga && ga[1]) || (document.querySelector('h1') || {}).textContent || document.title.split(/ [|\-–] /)[0];
    // Il testo dell'annuncio: la descrizione dei dati strutturati è la fonte più pulita
    const ldText = ld && ld.description ? htmlToText(ld.description) : '';
    const body = (ldText.length > 200 ? ldText + '\n' + text.slice(0, 3000) : text).slice(0, 30000);
    return {
      company: String(company).trim(),
      title: String(title).trim(),
      header: '',
      body,
      companyInfo: portal && portal.kind === 'agenzia' ? { agencySite: portal.name } : null
    };
  }

  const portals = {
    name: 'Portale',
    auto: true,
    test: () => !!portalFor(location.hostname),
    key: () => location.origin + location.pathname,
    read: () => genericRead(portalFor(location.hostname))
  };

  // Qualsiasi altro sito: solo su richiesta (clic sull'icona)
  const generic = {
    name: 'Pagina web',
    auto: false,
    test: () => true,
    key: () => location.origin + location.pathname,
    read: () => genericRead(null)
  };

  const ADAPTERS = [linkedin, indeed, portals, generic];

  function pickAdapter() {
    const a = ADAPTERS.find(x => x.test());
    if (!a) return null;
    if (!a.auto && !window.__AF_MANUAL) return null;
    return a;
  }

  function siteName(adapter) {
    if (adapter === portals) return (portalFor(location.hostname) || {}).name || 'Portale';
    if (adapter === generic) return location.hostname.replace(/^www\./, '');
    return adapter.name;
  }

  // ======================================================================
  // Analisi: segnali di "annuncio fantasma" e di condizioni poco serie
  // ======================================================================

  // Partita IVA come forma di contratto: "contratto con partita IVA", "richiesta P.IVA", "partita IVA obbligatoria",
  // "in possesso di partita IVA", "regime forfettario"... Non il numero di P.IVA dell'azienda nel piè di pagina.
  const PIVA = '(partita\\s*iva|p\\.\\s?iva)';
  const PIVA_RE = new RegExp(
    '(contratto|collaborazione|rapporto|lavorare|inquadramento)\\s+(con|a|in|tramite)\\s+(la\\s+|una\\s+)?' + PIVA +
    '|(richiest[ao]|richiede|richiediamo|serve|occorre|necessari[ao]|obbligatori[ao]|indispensabile|requisito)\\s*:?\\s+(la\\s+|una\\s+)?' + PIVA +
    '|' + PIVA + '\\s+(richiesta|necessaria|obbligatoria|indispensabile|propria|attiva)' +
    '|(possesso|titolare|apertura|aprire|munit[oi])\\s+(di\\s+)?(la\\s+|una\\s+)?' + PIVA +
    '|regime\\s+forfettario|libero\\s+professionista\\s+con\\s+' + PIVA, 'i');

  // Lavoro autonomo detto senza nominare la partita IVA
  const AUTONOMO_RE = /liber[oi]\s+professionist[ai]|libera\s+professione|(contratto|rapporto|regime|forma|collaborazione)\s+(di\s+)?lavoro\s+autonomo|lavorator[ei]\s+autonom[oi]/i;

  // Vero se c'è almeno una occorrenza non negata ("non si valutano liberi professionisti", "no partita IVA")
  const NEG_RE = /(\bnon\b|\bno\b|\bnessun[ao]?\b|esclus[ao]|senza|niente)[^.;:\n]{0,40}$/i;
  function affirmed(re, text) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(text))) {
      if (!NEG_RE.test(text.slice(Math.max(0, m.index - 45), m.index))) return true;
      if (m[0].length === 0) g.lastIndex++;
    }
    return false;
  }

  const SALARY_RE = /(€|EUR|USD|\$)\s?\d|\d[\d.,]*\s?[Kk]?\s?(€|EUR|USD|euro\b)|\/\s?(yr|hr)\b|\d[\d.,]*\s*(lordi|netti)?\s*(all.anno|all.ora|al mese|mensili)|\bRAL\b\s*:?\s*\d/i;

  function salaryText(info, ld) {
    if (ld && ld.baseSalary) {
      const v = ld.baseSalary.value || {};
      const cur = ld.baseSalary.currency || '';
      const unit = ({ HOUR: 'all\'ora', DAY: 'al giorno', WEEK: 'a settimana', MONTH: 'al mese', YEAR: 'all\'anno' })[String(v.unitText || '').toUpperCase()] || v.unitText || '';
      const eur = cur === 'EUR' ? '€' : cur;
      if (v.minValue && v.maxValue && v.minValue !== v.maxValue) return `${v.minValue}–${v.maxValue} ${eur} ${unit}`.trim();
      if (v.minValue || v.maxValue || v.value) return `${v.value || v.minValue || v.maxValue} ${eur} ${unit}`.trim();
    }
    const src = (info.header || info.body.slice(0, 4000)).replace(/[^\n]*Premium[^\n]*/gi, '');
    const m = src.match(/[^\n·|]*(\d[\d.,]*\s?[Kk]?\s?(€|EUR)|(€|EUR)\s?\d)[^\n·|]*/);
    return m ? m[0].trim().slice(0, 80) : '';
  }

  // "Oggi alle 17:26", "Ieri alle 9:00", "3 nov alle 10:00" (Subito e simili)
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function italianDateDays(text) {
    if (/\bOggi alle\b/i.test(text)) return 0;
    if (/\bIeri alle\b/i.test(text)) return 1;
    const m = text.match(/\b(\d{1,2})\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?(\s+(\d{4}))?\s+alle\b/i);
    if (!m) return null;
    const now = new Date();
    let d = new Date(m[4] ? parseInt(m[4], 10) : now.getFullYear(), MESI.indexOf(m[2].toLowerCase()), parseInt(m[1], 10));
    if (d > now) d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
    return (now - d) / DAY;
  }

  function analyze(info, ld) {
    const header = (info.header || '').replace(/[^\n]*Premium[^\n]*/gi, '');
    const body = info.body || '';
    const reasons = []; // [colore, testo]
    let score = 0;
    const add = (pts, color, text) => { score += pts; reasons.push([color, text]); };

    // --- Età dell'annuncio: dai dati strutturati o dal testo dell'intestazione ---
    let days = null;
    let reposted = false;
    if (ld && ld.datePosted && !isNaN(Date.parse(ld.datePosted))) {
      days = (Date.now() - Date.parse(ld.datePosted)) / DAY;
    }
    const ageSrc = header || body.slice(0, 1500);
    const m = ageSrc.match(AGE_RE);
    if (m) {
      reposted = /^(Ripubblicat|Reposted)/i.test(m[1] || '');
      const n = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : 1;
      const u = unitDays(m[3]);
      if (u !== null && days === null) days = n * u;
    }
    if (days === null) days = italianDateDays(ageSrc);
    const plus = ageSrc.match(/(\d+)\+\s*(giorni|days)/i);
    if (days === null && plus) days = parseInt(plus[1], 10) + 1;
    if (days === null && /più di 30 giorni/i.test(ageSrc)) days = 31;

    if (days === null) add(0, 'grigio', 'Data di pubblicazione non indicata');
    else if (days >= 30) add(2, 'rosso', `Online da circa ${Math.round(days)} giorni`);
    else if (days >= 14) add(1, 'giallo', `Online da circa ${Math.round(days)} giorni`);
    else add(0, 'verde', days < 1 ? 'Pubblicato da meno di un giorno' : `Pubblicato da circa ${Math.round(days)} giorni`);

    if (reposted) {
      if (days !== null && days < 14) add(1, 'giallo', 'Annuncio ripubblicato di recente');
      else add(2, 'rosso', 'Annuncio ripubblicato');
    }

    if (ld && ld.validThrough && !isNaN(Date.parse(ld.validThrough)) && Date.parse(ld.validThrough) < Date.now()) {
      add(2, 'rosso', 'Scaduto secondo i dati dell\'annuncio, ma ancora online');
    }
    if (/Non accetta più candidature|No longer accepting applications|annuncio scaduto|offerta scaduta/i.test(header + body.slice(0, 2000))) {
      add(3, 'rosso', 'Non accetta più candidature');
    }

    // --- Molti candidati ma ancora aperto ---
    const app = header.match(/Più di\s+(\d+)\s+(candidati|persone)|Over\s+(\d+)\s+(applicants|people)/i);
    if (app) {
      const n = parseInt(app[1] || app[3], 10);
      if (n >= 100 && days !== null && days >= 14) add(1, 'giallo', `Più di ${n} candidati e ancora aperto`);
    }

    // --- Retribuzione ---
    const asksMoney = /(corso|kit|materiale|formazione)\s+a pagamento|quota (di )?iscrizione|investimento iniziale/i.test(body);
    const salary = !asksMoney && ((ld && ld.baseSalary) || SALARY_RE.test(header || body.slice(0, 4000)));
    if (salary) add(0, 'verde', 'Retribuzione indicata');
    else add(1, 'giallo', 'Retribuzione non indicata');

    // --- Segnali specifici dei siti ---
    if (/Risposte gestite esternamente|Responses managed off LinkedIn/i.test(header)) add(1, 'giallo', 'Candidatura gestita fuori dal sito');
    if (/Nessuna informazione sulla risposta|No response insights/i.test(header)) add(0, 'grigio', 'Il sito non ha dati su quanto l\'azienda risponde');
    if (/Valutazione attiva delle candidature|Actively reviewing applicants/i.test(header + body.slice(0, 1500))) add(-1, 'verde', 'L\'azienda sta valutando attivamente le candidature');
    if (/Spesso risponde entro|Often responds within|risponde in genere entro/i.test(header + body.slice(0, 3000))) add(-1, 'verde', 'L\'azienda risponde spesso ai candidati');
    if (/Promoss[ao]|Promoted/i.test(header)) add(0, 'grigio', 'Annuncio promosso (a pagamento): solo informativo');
    if (/\bCollaborazione\b/.test(header)) add(1, 'giallo', 'Contratto di collaborazione, non da dipendente');

    // --- Chi pubblica: agenzia o società di selezione al posto dell'azienda finale ---
    const ci = info.companyInfo || {};
    const agency = ci.agencySite ||
      (ci.sector && /risorse umane|staffing|recruit|selezione|human resources/i.test(ci.sector)) ||
      /per (importante|primaria|nota) (azienda|società) cliente|per (conto di|una) (azienda|società) cliente|nostr[oa] client[ei]|our client/i.test(body);
    if (agency) add(1, 'giallo', 'Pubblicato da un\'agenzia o società di selezione: l\'azienda finale non è indicata');

    // --- Condizioni poco serie, nel testo dell'annuncio ---
    // employmentType "CONTRACTOR" non si usa: Randstad lo mette anche su contratti a tempo determinato
    const empType = ld && ld.employmentType ? [].concat(ld.employmentType).join(' ').toUpperCase() : '';
    const freelance = affirmed(AUTONOMO_RE, info.title || '') || affirmed(AUTONOMO_RE, body);
    if (affirmed(PIVA_RE, header + '\n' + body)) add(2, 'rosso', 'Partita IVA richiesta o tra le forme di contratto');
    else if (freelance) add(2, 'rosso', 'Lavoro autonomo (libera professione): di solito serve la partita IVA, non è da dipendente');
    if (affirmed(/\bprovvigion|guadagni\s+(illimitati|fino a)|solo a commissione/i, body)) add(2, 'rosso', 'Compenso a provvigione o "guadagni illimitati"');
    if (asksMoney) add(3, 'rosso', 'Ti chiedono di pagare qualcosa');
    if (affirmed(/prestazione occasionale|ritenuta d.acconto|collaborazione occasionale/i, body)) add(1, 'giallo', 'Prestazione occasionale o con ritenuta d\'acconto');
    if ((/stage|tirocinio|internship/i.test(info.title || '') || /INTERN/.test(empType)) && !salary) add(1, 'giallo', 'Stage o tirocinio senza rimborso indicato');
    if (body && body.replace(/\s+/g, ' ').length < 400) add(1, 'giallo', 'Descrizione molto scarna');

    score = Math.max(0, score);
    return { score, reasons, salary: salary ? salaryText(info, ld) : '', days };
  }

  // ======================================================================
  // Archivio locale
  // ======================================================================

  const store = {
    get: k => new Promise(res => chrome.storage.local.get(k, d => res(d ? d[k] : undefined))),
    set: (k, v) => new Promise(res => chrome.storage.local.set({ [k]: v }, res))
  };
  const diaryKey = company => 'af:' + company.toLowerCase();
  const siteKey = key => 'afjob:' + key;
  const normTitle = t => (t || '').toLowerCase().replace(/\(.*?\)|\b(m\/f|f\/m|m\/w|h\/f)\b/g, '').replace(/[^a-zà-ù0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const salKey = title => 'afsal:' + normTitle(title);
  const seenKey = key => 'afseen:' + key;

  // Ricorda la prima volta che hai visto l'annuncio: se poi la data "rinasce", è stato rinfrescato
  async function recordSeen(key) {
    const k = seenKey(key);
    const today = new Date().toISOString().slice(0, 10);
    let v = await store.get(k);
    if (!v) { v = { first: today }; await store.set(k, v); }
    return v;
  }

  // Ricorda gli stipendi visti per lo stesso ruolo (solo nel tuo browser), per confrontarli nel tempo
  async function recordSalary(title, company, site, salary, key) {
    if (!salary || !normTitle(title)) return [];
    const k = salKey(title);
    const list = (await store.get(k)) || [];
    if (!list.some(x => x.job === key)) {
      list.push({ job: key, date: new Date().toISOString().slice(0, 10), company, site, salary });
      while (list.length > 50) list.shift();
      await store.set(k, list);
    }
    return list;
  }

  // --- Esporta / importa: diario, verifiche e stipendi in un file JSON ---

  const isOurKey = k => k.startsWith('af:') || k.startsWith('afjob:') || k.startsWith('afsal:') || k.startsWith('afseen:');

  function exportData() {
    chrome.storage.local.get(null, all => {
      const data = {};
      for (const k of Object.keys(all || {})) if (isOurKey(k)) data[k] = all[k];
      const payload = { app: 'annunci-fantasma', version: 1, exported: new Date().toISOString(), data };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `annunci-fantasma-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }

  // Unisce i dati importati a quelli esistenti senza perdere nulla
  function mergeEntry(key, oldV, newV) {
    if (!oldV) return newV;
    if (key.startsWith('af:')) {
      const applied = [...(oldV.applied || [])];
      for (const a of newV.applied || []) if (!applied.some(x => x.job === a.job)) applied.push(a);
      return { applied, replies: Math.max(oldV.replies || 0, newV.replies || 0) };
    }
    if (key.startsWith('afsal:')) {
      const list = [...(oldV || [])];
      for (const s of newV || []) if (!list.some(x => x.job === s.job)) list.push(s);
      return list.slice(-50);
    }
    if (key.startsWith('afseen:')) return (oldV.first || '9') <= (newV.first || '9') ? oldV : newV; // la prima volta vista
    return (newV.date || '') >= (oldV.date || '') ? newV : oldV; // verifica più recente
  }

  function importData(onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let payload;
        try { payload = JSON.parse(reader.result); } catch (e) { note('File non valido: non è un JSON leggibile.'); return; }
        if (!payload || payload.app !== 'annunci-fantasma' || typeof payload.data !== 'object') {
          note('File non valido: non è un\'esportazione di Annunci Fantasma.');
          return;
        }
        const keys = Object.keys(payload.data).filter(isOurKey);
        chrome.storage.local.get(keys, current => {
          const merged = {};
          for (const k of keys) merged[k] = mergeEntry(k, (current || {})[k], payload.data[k]);
          chrome.storage.local.set(merged, () => { note(`Importati ${keys.length} elementi.`); onDone(); });
        });
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ======================================================================
  // Ricerche con un clic (le apri tu, in una nuova scheda)
  // ======================================================================

  // Confronto tra dipendenti dichiarati (fascia della pagina aziendale) e persone che dicono di lavorarci
  const num = t => parseInt(String(t).replace(/[.\s]/g, ''), 10);
  function employeeGap(ci) {
    if (!ci || !ci.employees || !ci.onLinkedIn) return null;
    const low = num(ci.employees.split('-')[0].replace('+', ''));
    const n = num(ci.onLinkedIn);
    if (!low || isNaN(n) || low < 50) return null;
    const pct = Math.round(n / low * 100);
    if (pct >= 20) return null;
    return {
      points: low >= 200 && pct < 5 ? 1 : 0,
      text: `Dichiara almeno ${low} dipendenti, ma solo ${n} persone su LinkedIn dicono di lavorarci (${pct}%). ` +
        'Può essere normale per aziende con molti operai o personale in negozio; altrimenti l\'azienda potrebbe essere più piccola di come si presenta: controlla i dati ufficiali.'
    };
  }

  const google = (q, news) => 'https://www.google.com/search?q=' + encodeURIComponent(q) + (news ? '&tbm=nws' : '');
  const cleanTitle = t => (t || '').replace(/\(.*?\)/g, '').trim();
  const SEARCHES = {
    site: (c, t) => google(`"${cleanTitle(t)}" "${c}" (careers OR "lavora con noi" OR carriere OR jobs) -site:linkedin.com -site:indeed.com`),
    finance: c => google(`"${c}" fatturato dipendenti`),
    registry: c => google(`"${c}" dipendenti fatturato (site:aziende.it OR site:companyreports.it OR site:ufficiocamerale.it)`),
    reviews: c => google(`"${c}" recensioni dipendenti (site:indeed.com OR site:glassdoor.it OR site:glassdoor.com)`),
    reddit: c => google(`site:reddit.com "${c}" (lavoro OR colloquio OR stipendio OR truffa OR licenziato OR "ci ho lavorato" OR "lavoro lì")`),
    trustpilot: c => 'https://it.trustpilot.com/search?query=' + encodeURIComponent(c),
    news: c => google(`"${c}" (licenziamenti OR esuberi OR "cassa integrazione" OR crisi OR fallimento OR assunzioni)`, true),
    salary: t => google(`"${cleanTitle(t)}" stipendio medio RAL Italia`)
  };

  // ======================================================================
  // Interfaccia
  // ======================================================================

  const COLORS = { verde: '#2e7d32', giallo: '#f9a825', rosso: '#c62828', grigio: '#9e9e9e' };

  function el(tag, style, text) {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function button(label, onClick, title) {
    const b = el('button',
      'margin:4px 6px 0 0;padding:4px 8px;border:1px solid #0a66c2;border-radius:12px;background:#fff;color:#0a66c2;cursor:pointer;font:12px system-ui,sans-serif',
      label);
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  const open = url => window.open(url, '_blank', 'noopener');

  function section(panel, text) {
    panel.appendChild(el('div', 'margin-top:8px;border-top:1px solid #eee;padding-top:6px;color:#444;font-weight:600', text));
  }

  function small(panel, text) {
    panel.appendChild(el('div', 'color:#555;font-size:12px;margin-top:2px', text));
  }

  // Messaggio dentro il riquadro (niente finestre alert, che bloccano la pagina)
  function note(text) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const n = el('div', 'margin-top:6px;padding:4px 6px;background:#fff8e1;border-radius:6px;font-size:12px', text);
    panel.appendChild(n);
    setTimeout(() => n.remove(), 5000);
  }

  async function render(ctx) {
    const { site, company, title, key, result, companyInfo } = ctx;
    const again = () => render(ctx);

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el('div',
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;width:320px;max-height:80vh;overflow:auto;' +
        'background:#fff;color:#222;border:1px solid #ccc;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.2);' +
        'font:13px/1.4 system-ui,sans-serif;padding:10px 12px;text-align:left;letter-spacing:normal');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }
    panel.textContent = '';

    const diary = (await store.get(diaryKey(company))) || { applied: [], replies: 0 };
    const check = (await store.get(siteKey(key))) || null;
    const salaries = await recordSalary(title, company, site, result.salary, key);
    const seen = await recordSeen(key);

    let score = result.score;
    const reasons = result.reasons.slice();
    const g0 = employeeGap(companyInfo || {});
    if (g0 && g0.points) { score += g0.points; reasons.push(['giallo', g0.text]); }
    const nApplied = diary.applied.length;
    if (nApplied >= 3 && diary.replies === 0) {
      score += 2;
      reasons.push(['rosso', `Ti sei candidato ${nApplied} volte a questa azienda senza risposta`]);
    }
    const seenDays = Math.floor((Date.now() - Date.parse(seen.first)) / 86400000);
    if (seenDays >= 7 && result.days !== null && result.days !== undefined && result.days < seenDays - 2) {
      score += 2;
      reasons.push(['rosso', `L'hai già visto il ${seen.first.split('-').reverse().join('/')}: la data di pubblicazione è stata rinnovata`]);
    }
    if (check && check.result === 'notfound') {
      score += 2;
      reasons.push(['rosso', `Non trovato sul sito dell'azienda (verificato il ${check.date})`]);
    } else if (check && check.result === 'found') {
      score = Math.max(0, score - 1);
      reasons.push(['verde', `Presente sul sito dell'azienda (verificato il ${check.date})`]);
    }

    const level = score >= 4 ? ['rosso', 'Rischio alto'] : score >= 2 ? ['giallo', 'Rischio medio'] : ['verde', 'Rischio basso'];
    try { chrome.runtime.sendMessage({ type: 'af-score', score, color: COLORS[level[0]] }); } catch (e) { /* estensione ricaricata: ignora */ }

    // Intestazione
    const head = el('div', 'display:flex;align-items:center;justify-content:space-between');
    const h = el('div', 'display:flex;align-items:center;font-weight:600');
    h.appendChild(el('span', `display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px;background:${COLORS[level[0]]}`));
    h.appendChild(el('span', '', `${level[1]} (punteggio ${score})`));
    const right = el('div', 'display:flex;align-items:center');
    const toggle = el('button', 'border:none;background:none;cursor:pointer;font-size:16px;color:#666', minimized ? '▴' : '▾');
    toggle.title = minimized ? 'Espandi' : 'Riduci';
    toggle.addEventListener('click', () => {
      minimized = !minimized;
      chrome.storage.local.set({ afui: { minimized } });
      again();
    });
    const close = el('button', 'border:none;background:none;cursor:pointer;font-size:16px;color:#666', '×');
    close.title = 'Chiudi';
    close.addEventListener('click', () => panel.remove());
    right.appendChild(toggle);
    right.appendChild(close);
    head.appendChild(h);
    head.appendChild(right);
    panel.appendChild(head);
    if (minimized) return;

    panel.appendChild(el('div', 'color:#666;margin:2px 0 6px', `${company} · ${site}`));

    // Segnali
    const ul = el('ul', 'margin:0;padding:0;list-style:none');
    for (const [c, t] of reasons) {
      const li = el('li', 'display:flex;align-items:flex-start;margin:2px 0');
      li.appendChild(el('span', `flex:none;width:8px;height:8px;border-radius:50%;margin:5px 8px 0 0;background:${COLORS[c]}`));
      li.appendChild(el('span', '', t));
      ul.appendChild(li);
    }
    panel.appendChild(ul);

    // L'azienda: dati letti dalla pagina + ricerche con un clic
    section(panel, 'L\'azienda');
    const ci = companyInfo || {};
    const gap = employeeGap(ci);
    const facts = [];
    if (ci.employees) facts.push(`${ci.employees} dipendenti`);
    if (ci.onLinkedIn) facts.push(`${ci.onLinkedIn} su LinkedIn`);
    if (ci.followers) facts.push(`${ci.followers} follower`);
    if (ci.sector) facts.push(ci.sector);
    if (ci.rating) facts.push(`valutazione ${ci.rating}`);
    small(panel, facts.length ? facts.join(' · ') : 'Questa pagina non riporta dati sull\'azienda.');
    if (gap && !gap.points) small(panel, gap.text);
    panel.appendChild(button('Dipendenti e fatturato ufficiali', () => open(SEARCHES.registry(company)), 'Dati della Camera di Commercio (dipendenti dichiarati, fatturato, utile) su aziende.it, companyreports.it, ufficiocamerale.it'));
    panel.appendChild(button('Recensioni', () => open(ci.reviewsUrl || SEARCHES.reviews(company)), 'Recensioni di chi ci lavora o ci ha lavorato (Indeed, Glassdoor)'));
    panel.appendChild(button('Reddit', () => open(SEARCHES.reddit(company)), 'Discussioni su Reddit: colloqui, stipendi, lamentele'));
    panel.appendChild(button('Trustpilot', () => open(SEARCHES.trustpilot(company)), 'Recensioni dei clienti: un\'azienda che tratta male i clienti spesso tratta male anche i dipendenti'));
    panel.appendChild(button('Notizie', () => open(SEARCHES.news(company)), 'Notizie recenti: assunzioni, licenziamenti, crisi'));

    // Stipendi visti per lo stesso ruolo
    section(panel, 'Stipendio');
    if (result.salary) small(panel, `In questo annuncio: ${result.salary}`);
    const others = salaries.filter(s => s.job !== key);
    if (others.length) {
      small(panel, `Per questo ruolo hai già visto ${others.length} ${others.length === 1 ? 'annuncio' : 'annunci'} con stipendio:`);
      for (const s of others.slice(-3).reverse()) small(panel, `· ${s.salary} — ${s.company} (${s.date})`);
    } else {
      small(panel, 'Il confronto con altri annunci dello stesso ruolo cresce mentre ne guardi altri.');
    }
    panel.appendChild(button('Stipendi del ruolo', () => open(SEARCHES.salary(title)), 'Cerca lo stipendio medio di questo ruolo'));

    // Diario
    section(panel, 'Il tuo diario');
    small(panel, `Con questa azienda: ${nApplied} candidature, ${diary.replies} risposte`);
    const already = diary.applied.some(a => a.job === key);
    panel.appendChild(button(already ? 'Candidatura già segnata' : 'Mi sono candidato', async () => {
      if (already) return;
      diary.applied.push({ job: key, date: new Date().toISOString().slice(0, 10) });
      await store.set(diaryKey(company), diary);
      again();
    }));
    panel.appendChild(button('Mi hanno risposto', async () => {
      diary.replies += 1;
      await store.set(diaryKey(company), diary);
      again();
    }));

    // Verifica sul sito aziendale
    section(panel, 'È anche sul sito dell\'azienda?');
    const today = () => new Date().toISOString().slice(0, 10);
    panel.appendChild(button('Cerca sul web', () => open(SEARCHES.site(company, title))));
    panel.appendChild(button(check && check.result === 'found' ? 'Trovato ✓' : 'Trovato', async () => {
      await store.set(siteKey(key), { result: 'found', date: today() });
      again();
    }));
    panel.appendChild(button(check && check.result === 'notfound' ? 'Non trovato ✓' : 'Non trovato', async () => {
      await store.set(siteKey(key), { result: 'notfound', date: today() });
      again();
    }));

    // Salvataggio dei propri dati
    section(panel, 'I tuoi dati');
    panel.appendChild(button('Esporta', exportData, 'Scarica diario, verifiche e stipendi visti'));
    panel.appendChild(button('Importa', () => importData(again), 'Carica un file esportato e uniscilo ai dati attuali'));

    panel.appendChild(el('div', 'margin-top:6px;font-size:11px;color:#888',
      'Indice di rischio, non un verdetto. I dati restano nel tuo browser.'));
  }

  // ======================================================================
  // Ciclo principale
  // ======================================================================

  function tick() {
    try { step(); } catch (e) { console.warn('Annunci Fantasma:', e); }
  }

  function clearPanel() {
    const p = document.getElementById(PANEL_ID);
    if (p) {
      p.remove();
      try { chrome.runtime.sendMessage({ type: 'af-score', score: '', color: '#9e9e9e' }); } catch (e) { /* ignora */ }
    }
  }

  function step() {
    const adapter = pickAdapter();
    if (!adapter) { clearPanel(); lastKey = ''; return; }
    const key = adapter.key();
    if (!key) return;
    if (key === lastKey) return; // già analizzato (se l'hai chiuso, resta chiuso)

    // Nasconde il riquadro mentre legge la pagina, così il suo testo non viene analizzato
    const panelEl = document.getElementById(PANEL_ID);
    if (panelEl) panelEl.style.display = 'none';
    let info;
    try { info = adapter.read(); } finally { if (panelEl) panelEl.style.display = ''; }
    if (!info) {
      // Sui portali, una pagina che non è un annuncio non mostra il riquadro
      if (adapter === portals) clearPanel();
      return;
    }

    // Se l'azienda non è ancora caricata, riprova per qualche giro prima di arrendersi
    if (!info.company) {
      retries = key === retryKey ? retries + 1 : 1;
      retryKey = key;
      if (retries < 6) return;
      info.company = 'Azienda non riconosciuta';
    }

    lastKey = key;
    const ld = readJobPostingLD();
    const site = siteName(adapter);
    render({
      site,
      company: info.company,
      title: info.title,
      key: site + ':' + key,
      result: analyze(info, ld),
      companyInfo: info.companyInfo
    });
  }

  setInterval(tick, 1500);
  tick();
})();
