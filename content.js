// Annunci Fantasma — v1.4.0
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
    { re: /(^|\.)subito\.it$/, name: 'Subito', kind: 'portale', detail: /^\/offerte-lavoro\/.+-\d+\.htm$/,
      company: ['[class*="_company_name"] h6', '[class*="_shop-link"] [class*="_user-name"]'],
      privateSel: '[class*="_private-user-column"] [class*="_name"]',
      titleCompany: /^Subito - (.+?) - /,
      bodySel: '[class*="_description"]:not([class*="description-title"])',
      headerRange: [/\nOFFERTE DI LAVORO\n/, /\nDescrizione\n/],
      extra: () => { const f = [...document.querySelectorAll('ul,section,div')].find(e => /^Livello\b/.test(e.innerText || '') && e.innerText.length < 800); return f ? f.innerText : ''; } },
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
    { re: /(^|\.)personio\.(de|com|it)$/, name: 'Personio', kind: 'ats' },
    { re: /(^|\.)in-recruiting\.com$/, name: 'InRecruiting', kind: 'ats' },
    { re: /(^|\.)workable\.com$/, name: 'Workable', kind: 'ats' },
    { re: /(^|\.)successfactors\.(com|eu)$/, name: 'SAP SuccessFactors', kind: 'ats' },
    { re: /(^|\.)taleo\.net$/, name: 'Oracle Taleo', kind: 'ats' },
    { re: /(^|\.)icims\.com$/, name: 'iCIMS', kind: 'ats' },
    { re: /(^|\.)bamboohr\.com$/, name: 'BambooHR', kind: 'ats' }
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
    const sel = portal && portal.company ? [].concat(portal.company).map(q => document.querySelector(q)).find(Boolean) : null;
    const tc = portal && portal.titleCompany ? document.title.match(portal.titleCompany) : null;
    let company = (ld && ld.hiringOrganization && (ld.hiringOrganization.name || ld.hiringOrganization)) || (ga && ga[2]) ||
      (sel ? (sel.textContent || '').trim() : '') || (tc ? tc[1] : '');
    if (!company && portal && portal.kind === 'ats') {
      company = og || location.hostname.split('.')[0];
    }
    if (!company && !portal) company = og || location.hostname.replace(/^www\./, '');
    let privateUser = false;
    if (!company && portal && portal.privateSel) {
      const pv = document.querySelector(portal.privateSel);
      if (pv && pv.textContent.trim()) { company = pv.textContent.trim() + ' (privato)'; privateUser = true; }
    }
    if (!company) company = 'Azienda non indicata';
    const title = (ld && ld.title) || (ga && ga[1]) || (document.querySelector('h1') || {}).textContent || document.title.split(/ [|\-–] /)[0];
    // Il testo dell'annuncio: la descrizione dei dati strutturati è la fonte più pulita
    const ldText = ld && ld.description ? htmlToText(ld.description) : '';
    // Portali con struttura nota: solo intestazione e descrizione dell'annuncio, senza menu e "ricerche simili"
    const bodyEl = portal && portal.bodySel ? document.querySelector(portal.bodySel) : null;
    const extra = portal && portal.extra ? portal.extra() : '';
    let header = '';
    if (portal && portal.headerRange) {
      const full = '\n' + (root.innerText || '');
      const a = full.search(portal.headerRange[0]);
      const b = a >= 0 ? full.slice(a + 1).search(portal.headerRange[1]) : -1;
      if (a >= 0 && b > 0) header = full.slice(a, a + 1 + b).trim();
    }
    if (extra) header += '\n' + extra;
    const own = bodyEl ? (bodyEl.innerText || '') + (extra ? '\n' + extra : '') : '';
    const body = (ldText.length > 200 ? ldText + '\n' + text.slice(0, 3000) : own.length > 50 ? own : text).slice(0, 30000);
    return {
      company: String(company).trim(),
      title: String(title).trim(),
      header,
      body,
      kwText: ldText.length > 200 ? ldText : own.length > 50 ? own : text,
      companyInfo: portal && portal.kind === 'agenzia' ? { agencySite: portal.name } : privateUser ? { privateUser: true } : null
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
    if (/\bCollaborazione\b/.test(header) || /Tipo di contratto\s*\n?\s*(Contratto a progetto|Collaborazione|Co\.?co\.?co)/i.test(header)) add(1, 'giallo', 'Contratto di collaborazione o a progetto, non da dipendente');

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
    if (info.companyInfo && info.companyInfo.privateUser) add(1, 'giallo', 'Pubblicato da un privato, non da un\'azienda: prima del colloquio chiedi nome dell\'azienda e partita IVA del datore di lavoro');
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

  const isOurKey = k => k === 'afcv' || k.startsWith('afreg:') || k.startsWith('af:') || k.startsWith('afjob:') || k.startsWith('afsal:') || k.startsWith('afseen:');

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
  // Dati ufficiali dell'azienda (Registro Imprese) letti dalle pagine che apri tu
  // ======================================================================
  // L'estensione non interroga questi siti da sola: legge la pagina dell'azienda quando la apri
  // (aziende.it, companyreports.it, ufficiocamerale.it) e la collega agli annunci di quell'azienda.

  const REGISTRY_RE = /(^|\.)(aziende\.it|companyreports\.it|ufficiocamerale\.it)$/;
  const LEGAL = /\b(s\.?\s?r\.?\s?l\.?\s?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?n\.?\s?c\.?|soc(ieta)?\.?\s+coop(erativa)?\.?|scarl|unipersonale|societa\s+a\s+responsabilita\s+limitata(\s+semplificata)?|societa\s+per\s+azioni)\b/g;
  function normCompany(c) {
    return String(c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/['’`]/g, '').replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  const regKey = c => 'afreg:' + normCompany(c);

  const euro = v => v ? parseInt(String(v).replace(/[^\d-]/g, ''), 10) : null;

  function parseRegistry(text) {
    // Solo la scheda dell'azienda: si taglia prima degli elenchi di "altre aziende" (che hanno i loro stati)
    let t = '\n' + text.replace(/\r/g, '');
    const cut = t.search(/\n\s*(Altre aziende|Aziende simili|Aziende correlate|Aziende della stessa|Documenti ufficiali|Potrebbe interessarti)/i);
    if (cut > 200) t = t.slice(0, cut);
    const m = re => { const x = t.match(re); return x ? x : null; };
    const r = {};
    let x;
    const STATI = '(ATTIVA|INATTIVA|CESSATA|IN LIQUIDAZIONE|SCIOLTA|FALLITA|IN FALLIMENTO|IN SCIOGLIMENTO|SOSPESA)';
    if ((x = t.slice(0, 1500).match(new RegExp('\\n' + STATI + '\\n'))) || (x = m(/Stato Attivit[aà]\s*[\t|:\n]\s*([A-Za-zà ]{4,30})/i)) ||
      (x = m(/risulta attualmente un.impresa\s+(attiva|inattiva|cessata)/i))) r.status = x[1].trim().toLowerCase();
    if ((x = m(/(\d+)\nDipendenti\b/)) || (x = m(/contava\s+(\d+)\s+dipendenti/i)) || (x = m(/N\.?\s*Dipendenti\s*[\t|:\n]\s*(da \d+ a \d+|\d+(-\d+)?)/i)) ||
      (x = m(/compreso tra\s+(\d+-\d+)\s+dipendenti/i)) || (x = m(/Dipendenti\s*[\t|:]\s*(\d+-\d+|\d+)\s*dipendenti/i))) r.employees = x[1];
    if ((x = m(/€\s*([\d.]+)\nFatturato\s+(\d{4})/)) || (x = m(/Fatturato\s*[\t|:\n]\s*€?\s*([\d.]+)\s*(?:euro\s*)?\((\d{4})\)/i)) || (x = m(/fatturato di €\s*([\d.]+)/i))) {
      r.revenue = euro(x[1]); if (x[2]) r.revenueYear = x[2];
    }
    if ((x = m(/([+-]\d+(?:,\d+)?)%\nVariazione/)) || (x = m(/in (calo|crescita) del (\d+(?:,\d+)?)%/i))) {
      r.revenueChange = x.length > 2 && /calo|crescita/i.test(x[1]) ? (x[1].toLowerCase() === 'calo' ? '-' : '+') + x[2] : x[1];
    }
    if ((x = m(/€\s*([\d.]+)\n(Utile|Perdita)\s+(\d{4})/))) r.profit = (x[2] === 'Perdita' ? -1 : 1) * euro(x[1]);
    else if ((x = m(/chiudendo con una perdita di €\s*([\d.]+)/i))) r.profit = -euro(x[1]);
    else if ((x = m(/chiudendo con un utile di €\s*([\d.]+)/i))) r.profit = euro(x[1]);
    else if ((x = m(/Utile\s*[\t|:\n]\s*€?\s*(-?[\d.]+)\s*(?:euro\s*)?\((\d{4})\)/i))) r.profit = euro(x[1]);
    if ((x = m(/Data Iscrizione\s*[\t|:\n]\s*(\d{2}\/\d{2}\/(\d{4}))/i)) || (x = m(/Fondazione\s*[\t|:\n]\s*(\d{2}\/\d{2}\/(\d{4}))/i))) r.since = x[2];
    else if ((x = m(/\ndal (\d{4})\n/))) r.since = x[1];
    if ((x = m(/€\s*([\d.]+)\nCapitale sociale/i)) || (x = m(/Capitale Sociale\s*[\t|:\n]\s*€?\s*([\d.]+)/i))) r.capital = euro(x[1]);
    if ((x = m(/P(?:artita)?\.?\s?IVA\s*[:\n\t]?\s*(\d{11})/i))) r.piva = x[1];
    return r;
  }

  function maxEmployees(e) {
    if (!e) return null;
    const n = String(e).match(/\d+/g);
    return n ? Math.max(...n.map(Number)) : null;
  }

  const fmtEuro = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('it-IT') + ' €';

  function registrySummary(r) {
    const out = [];
    if (r.status) out.push(r.status === 'attiva' ? 'attiva' : r.status.toUpperCase());
    if (r.employees) out.push(`${r.employees} dipendenti`);
    if (r.revenue) out.push(`fatturato ${fmtEuro(r.revenue)}${r.revenueYear ? ' (' + r.revenueYear + ')' : ''}${r.revenueChange ? ', ' + r.revenueChange + '%' : ''}`);
    if (r.profit !== undefined && r.profit !== null) out.push(r.profit < 0 ? `perdita ${fmtEuro(-r.profit)}` : `utile ${fmtEuro(r.profit)}`);
    if (r.since) out.push(`dal ${r.since}`);
    if (r.capital) out.push(`capitale ${fmtEuro(r.capital)}`);
    return out.join(' · ');
  }

  const BIG_CLAIM_RE = /multinazional[ei]|leader (nel|del|di|in|a livello)|grande (azienda|gruppo|realt[aà])|gruppo (internazionale|leader)|realt[aà] (in forte|in continua|in costante) crescita|forte espansione|azienda strutturata|importante (gruppo|realt[aà])/i;

  function requirementCount(text) {
    let part = requirementsPart(text || '');
    if (part === text) return 0;
    part = part.slice(0, 2500);
    // Una riga per requisito (elenchi puntati o righe brevi), esclusa la riga del titolo
    const lines = part.split('\n').slice(1).map(l => l.trim()).filter(l => l.length >= 3 && l.length <= 220);
    const bullets = lines.filter(l => /^([-•·*▪●–]|\d+[.)])\s*\S/.test(l) || /;\s*$/.test(l));
    const inline = (part.match(/;/g) || []).length + 1;
    return Math.max(bullets.length, lines.length > 2 ? lines.length : 0, inline > 3 ? inline : 0);
  }

  // Confronta l'annuncio con i dati ufficiali: segnali e motivi
  function registryCheck(reg, adText) {
    const out = [];
    if (!reg) return out;
    if (reg.status && reg.status !== 'attiva') out.push([3, 'rosso', `Nel Registro Imprese risulta "${reg.status}": un'azienda così non dovrebbe assumere`]);
    const emp = maxEmployees(reg.employees);
    const claim = (adText || '').match(BIG_CLAIM_RE);
    if (claim && emp !== null && emp < 10) out.push([1, 'giallo', `L'annuncio parla di «${claim[0]}», ma i dati ufficiali dicono ${reg.employees} dipendenti`]);
    const reqs = requirementCount(adText);
    if (emp !== null && emp < 10 && reqs >= 10) out.push([1, 'giallo', `Chiede ${reqs} requisiti diversi a fronte di un'azienda di ${reg.employees} dipendenti: potrebbero cercare un tuttofare`]);
    const ch = reg.revenueChange ? parseFloat(String(reg.revenueChange).replace(',', '.')) : 0;
    if (reg.profit !== undefined && reg.profit !== null && reg.profit < 0 && ch <= -10) out.push([1, 'giallo', `Conti in difficoltà: perdita nell'ultimo bilancio e fatturato in calo (${reg.revenueChange}%)`]);
    if (reg.since && new Date().getFullYear() - parseInt(reg.since, 10) < 1) out.push([0, 'grigio', 'Azienda iscritta da meno di un anno']);
    return out;
  }

  // Sulle pagine dei registri: legge i dati e li collega agli annunci
  async function registryMode() {
    const text = (document.querySelector('main') || document.body).innerText || '';
    const reg = parseRegistry(text);
    if (!reg.employees && !reg.revenue && !reg.status) return; // non è la pagina di un'azienda
    const name = ((document.querySelector('h1') || {}).textContent || document.title.split(/[:|–-]/)[0]).trim();
    reg.name = name;
    reg.source = location.hostname.replace(/^www\./, '');
    reg.url = location.href;
    reg.date = new Date().toISOString().slice(0, 10);
    const pending = await store.get('afpending');
    const forAd = pending && Date.now() - pending.time < 3600 * 1000 ? pending.company : null;
    await store.set(regKey(name), reg);
    if (forAd) await store.set(regKey(forAd), reg);

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el('div',
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;width:300px;' +
        'background:#fff;color:#222;border:1px solid #ccc;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.2);' +
        'font:13px/1.4 system-ui,sans-serif;padding:10px 12px;text-align:left;letter-spacing:normal');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }
    panel.textContent = '';
    const head = el('div', 'display:flex;align-items:center;justify-content:space-between');
    head.appendChild(el('div', 'font-weight:600', 'Dati ufficiali salvati'));
    head.appendChild(button('×', () => panel.remove(), 'Chiudi'));
    panel.appendChild(head);
    small(panel, `${name}: ${registrySummary(reg)}`);
    small(panel, forAd && normCompany(forAd) !== normCompany(name)
      ? `Collegati agli annunci di «${forAd}». Controlla che sia la stessa azienda (stessa città, stessa attività): se non lo è, apri quella giusta.`
      : 'Li vedrai nel riquadro degli annunci di questa azienda.');
  }

  // ======================================================================
  // Come funziona la candidatura (ATS) — spiegato in parole semplici
  // ======================================================================

  // Fonti dei fatti qui sotto: documentazione dei produttori e guide per candidati (vedi README).
  const ATS_INFO = [
    { re: /myworkdayjobs\.com|myworkdaysite\.com/, name: 'Workday',
      what: 'Programma usato soprattutto da grandi aziende. Ogni azienda ha il suo portale: di solito ti chiede di creare un account (email e password) valido solo per quell\'azienda.',
      tips: ['Dopo aver caricato il CV controlla i campi compilati da soli (date, mansioni): spesso vanno corretti a mano.',
        'Segnati email e password usate per questa azienda: per vedere lo stato della candidatura dovrai rientrare lì.'] },
    { re: /greenhouse\.io/, name: 'Greenhouse',
      what: 'Modulo breve su una sola pagina. L\'account non è obbligatorio.',
      tips: ['Le domande aggiuntive del modulo le legge una persona: rispondi in modo mirato, non con frasi fatte.'] },
    { re: /lever\.co/, name: 'Lever',
      what: 'Modulo breve, di solito senza account.',
      tips: ['Se c\'è un campo "informazioni aggiuntive", usalo per 3-4 righe che collegano la tua esperienza a questo annuncio.'] },
    { re: /smartrecruiters\.com/, name: 'SmartRecruiters',
      what: 'Modulo che può importare i tuoi dati dal CV o da LinkedIn.',
      tips: ['Controlla quello che importa prima di inviare: a volte mescola esperienze e date.'] },
    { re: /intervieweb\.it|in-recruiting\.com/, name: 'InRecruiting',
      what: 'Programma italiano (gruppo Zucchetti), molto usato da aziende e agenzie in Italia. Spesso chiede di registrarti sul portale carriere dell\'azienda e di compilare il profilo campo per campo.',
      tips: ['Compila tutti i campi del profilo, anche quelli che sembrano ripetere il CV: il selezionatore cerca proprio in quei campi.'] },
    { re: /successfactors\.(com|eu)/, name: 'SAP SuccessFactors',
      what: 'Programma usato da grandi aziende. Di solito richiede un account per azienda e un modulo lungo.',
      tips: ['Tieni a portata di mano date precise di inizio e fine di ogni lavoro.'] },
    { re: /taleo\.net|oraclecloud\.com\/hcmUI\/CandidateExperience/, name: 'Oracle (Taleo / Recruiting Cloud)',
      what: 'Programma usato da grandi aziende. Di solito richiede un account e un modulo lungo.',
      tips: ['Tieni a portata di mano date precise di inizio e fine di ogni lavoro.'] },
    { re: /icims\.com/, name: 'iCIMS', what: 'Programma usato da grandi aziende, spesso con account e modulo in più passaggi.', tips: [] },
    { re: /teamtailor\.com/, name: 'Teamtailor', what: 'Modulo semplice sul sito carriere dell\'azienda.', tips: [] },
    { re: /recruitee\.com/, name: 'Recruitee', what: 'Modulo semplice sul sito carriere dell\'azienda.', tips: [] },
    { re: /personio\.(de|com|it)/, name: 'Personio', what: 'Modulo semplice sul sito carriere dell\'azienda.', tips: [] },
    { re: /workable\.com/, name: 'Workable', what: 'Modulo semplice sul sito carriere dell\'azienda.', tips: [] },
    { re: /bamboohr\.com/, name: 'BambooHR', what: 'Modulo semplice sul sito carriere dell\'azienda.', tips: [] }
  ];

  const ATS_GENERAL = 'Un ATS è il programma con cui l\'azienda raccoglie e ordina le candidature. ' +
    'Non è un robot che ti scarta da solo: legge il CV, ne estrae i dati, e il selezionatore cerca tra i candidati usando parole chiave. ' +
    'Per questo conviene usare le stesse parole dell\'annuncio (se quelle competenze le hai davvero). ' +
    'Il famoso "75% dei CV scartati dagli ATS" non ha fonti: viene da una pubblicità del 2012.';
  const CV_TIPS = 'Per farti leggere bene: CV in PDF o Word con testo vero (non una foto o una scansione), ' +
    'informazioni importanti fuori da tabelle, colonne e grafici, titoli semplici (Esperienze, Formazione, Competenze), date scritte sempre nello stesso modo.';

  function detectApplication(adapter, header) {
    const href = location.href;
    const own = ATS_INFO.find(a => a.re.test(href));
    if (own) return { kind: 'ats', ...own };
    const links = [...document.querySelectorAll('a[href]')].map(a => a.href);
    for (const a of ATS_INFO) {
      if (links.some(h => a.re.test(h))) return { kind: 'ats', ...a, viaLink: true };
    }
    const portal = portalFor(location.hostname);
    if (adapter && adapter.name === 'LinkedIn') {
      if (/Candidatura semplice|Easy Apply/i.test(header)) return { kind: 'site', name: 'Candidatura semplice di LinkedIn',
        what: 'La candidatura resta su LinkedIn: l\'azienda riceve il tuo profilo LinkedIn e il CV che alleghi.',
        tips: ['Il profilo LinkedIn conta quanto il CV: titolo, competenze ed esperienze devono essere aggiornati.'] };
      return { kind: 'unknown', name: 'Sito esterno',
        what: 'Cliccando "Candidati" vai sul sito dell\'azienda. Quale programma usa lo vedrai lì: se è uno di quelli conosciuti, questo riquadro te lo spiega.', tips: [] };
    }
    if (adapter && adapter.name === 'Indeed') {
      if (/sito dell.azienda|company site/i.test(header)) return { kind: 'unknown', name: 'Sito esterno',
        what: 'La candidatura si fa sul sito dell\'azienda. Quale programma usa lo vedrai lì: se è uno di quelli conosciuti, questo riquadro te lo spiega.', tips: [] };
      return { kind: 'site', name: 'Modulo di Indeed', what: 'La candidatura passa da Indeed, che inoltra il tuo CV all\'azienda.',
        tips: ['Il CV caricato su Indeed è quello che vedono: tienilo aggiornato.'] };
    }
    if (portal && portal.kind === 'agenzia') return { kind: 'site', name: `Banca dati di ${portal.name}`,
      what: 'La candidatura entra nella banca dati dell\'agenzia. Un selezionatore dell\'agenzia cerca tra i candidati per parole chiave e ti propone all\'azienda cliente.',
      tips: ['Tieni il profilo aggiornato: possono chiamarti anche per altre offerte.'] };
    return null;
  }

  // --- Parole chiave dell'annuncio a confronto con il tuo CV (tutto nel browser) ---
  const STOP = new Set(('a ad al alla alle allo agli ai anche ancora che chi ci con come da dal dalla dalle dei del della delle dello degli di e ed è gli ha hai hanno il in io la le lo loro ma mi ne nei nel nella nelle non noi o per più può quale quali quando questa queste questi questo se si sia sono su sua sue sui sul sulla suo suoi tra tu un una uno vi voi ' +
    'essere avere fare deve devono dovrà sarà saranno verrà verranno ogni tutto tutti tutte molto buona buone buon buono ottima ottime ottimo ottimi forte elevata elevato capacità conoscenza conoscenze esperienza esperienze anni anno almeno preferibilmente gradita gradito graditi requisiti requisito ' +
    'azienda aziende società cliente clienti ricerca ricerchiamo cerchiamo cerca offriamo offre offerta inserimento candidato candidati candidata candidatura figura risorsa ruolo posizione attività lavoro lavorare settore team area ambito ufficio sede zona orario orari contratto tempo livello ccnl ' +
    'annuncio annunci mansioni principali seguenti relative relativo nostro nostra nostri vostro proprio propria possesso completano profilo descrizione info informazioni dettagli luogo data ' +
    'the and for with you your our are will have has from that this job role team work years experience skills ability knowledge strong good').split(/\s+/).map(w => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
  const PHRASES = ['pacchetto office', 'power bi', 'patente b', 'problem solving', 'customer care', 'customer service', 'data entry',
    'social media', 'google analytics', 'partita doppia', 'lingua inglese', 'inglese fluente', 'help desk', 'service desk',
    'project management', 'public speaking', 'lavoro di squadra', 'team working', 'gestione del tempo', 'carrelli elevatori', 'muletto'];

  const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const stem = w => (w.length >= 6 ? w.slice(0, w.length - 2) : w);

  function requirementsPart(text) {
    const i = text.search(/requisiti|competenze richieste|cosa cerchiamo|profilo ricercato|il candidato ideale|requirements|qualifications/i);
    if (i < 0) return text;
    const rest = text.slice(i);
    const j = rest.slice(30).search(/cosa offriamo|offriamo|si offre|benefit|what we offer/i);
    return j > 0 ? rest.slice(0, j + 30) : rest;
  }

  function adKeywords(text, max = 14) {
    const src = norm(requirementsPart(text).slice(0, 8000));
    const found = [];
    for (const p of PHRASES) if (src.includes(norm(p))) found.push(p);
    const counts = new Map();
    const shown = new Map();
    const order = [];
    const raw = requirementsPart(text).slice(0, 8000).match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9+#.]{1,}/g) || [];
    for (let w of raw) {
      w = w.replace(/\.+$/, '');
      const isAcr = /[A-Z]/.test(w) && (/^[A-Z0-9+#]{2,4}$/.test(w) || /^(?=.*[0-9+#])[A-Z0-9+#]{2,6}$/.test(w));
      const n = norm(w);
      if (!isAcr && (n.length < 4 || STOP.has(n))) continue;
      if (found.some(p => norm(p).split(' ').includes(n))) continue;
      const k = isAcr ? w : n;
      if (!counts.has(k)) { order.push(k); shown.set(k, isAcr ? w : w.toLowerCase()); }
      counts.set(k, (counts.get(k) || 0) + (isAcr ? 2 : 1));
    }
    const words = order.slice().sort((a, b) => counts.get(b) - counts.get(a) || order.indexOf(a) - order.indexOf(b));
    return [...found, ...words.map(k => shown.get(k))].slice(0, max);
  }

  function inCv(term, cvNorm) {
    const t = norm(term);
    if (t.includes(' ')) return cvNorm.includes(t);
    if (/^[a-z0-9+#]{2,6}$/.test(t) && term === term.toUpperCase()) return new RegExp('(^|[^a-z0-9])' + t.replace(/[+#.]/g, '\\$&') + '($|[^a-z0-9])').test(cvNorm);
    return cvNorm.includes(stem(t));
  }

  function compareCv(adText, cv) {
    const cvNorm = norm(cv || '');
    const terms = adKeywords(adText);
    return { have: terms.filter(t => inCv(t, cvNorm)), miss: terms.filter(t => !inCv(t, cvNorm)) };
  }

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

  function cvEditor(panel, text, done) {
    if (panel.querySelector('#af-cv-box')) return;
    const box = el('div', 'margin-top:6px');
    box.id = 'af-cv-box';
    const ta = el('textarea', 'width:100%;height:120px;box-sizing:border-box;font:12px system-ui,sans-serif');
    ta.value = text;
    ta.placeholder = 'Apri il tuo CV, seleziona tutto il testo (Ctrl+A), copialo e incollalo qui.';
    box.appendChild(ta);
    box.appendChild(button('Salva', async () => {
      const v = ta.value.trim();
      if (v) await store.set('afcv', { text: v.slice(0, 30000), date: new Date().toISOString().slice(0, 10) });
      else await new Promise(res => chrome.storage.local.remove('afcv', res));
      done();
    }));
    box.appendChild(button('Annulla', () => box.remove()));
    panel.appendChild(box);
    ta.focus();
  }

  // Pagine del modulo di candidatura: qui mancano i dati dell'annuncio, quindi non si ricalcola il rischio
  function isApplyFlow() {
    const h = location.hostname, p = location.pathname + location.search;
    if (/^(smartapply|apply|m5apply)\.indeed\.com$/.test(h)) return true;
    if (/(^|\.)indeed\.[a-z.]+$/.test(h) && /\/(apply|indeedapply)(\/|$|\?)/i.test(p)) return true;
    const ats = ATS_INFO.some(a => a.re.test(location.href));
    return ats && /\/(apply|application|applications|candidatura|candidati|login|signin|register|createaccount)(\/|$|\?|\b)/i.test(p);
  }

  async function renderApplyMode() {
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
    try { chrome.runtime.sendMessage({ type: 'af-score', score: null }); } catch (e) { /* ignora */ }
    const head = el('div', 'display:flex;align-items:center;justify-content:space-between');
    head.appendChild(el('div', 'font-weight:600', 'Candidatura in corso'));
    head.appendChild(button('×', () => panel.remove(), 'Chiudi'));
    panel.appendChild(head);
    const last = await store.get('aflast');
    if (last && Date.now() - last.time < 6 * 3600 * 1000) {
      const row = el('div', 'display:flex;align-items:center;margin-top:6px');
      row.appendChild(el('span', `display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:${COLORS[last.level]}`));
      row.appendChild(el('span', '', `${last.title} — ${last.company}: ${last.label.toLowerCase()} (punteggio ${last.score})`));
      panel.appendChild(row);
      small(panel, 'È il giudizio dato sulla pagina dell\'annuncio, dove ci sono tutte le informazioni. Qui sei nel modulo di candidatura: non lo ricalcolo, perché qui l\'annuncio non c\'è.');
    } else {
      small(panel, 'Sei nel modulo di candidatura. Il semaforo si calcola sulla pagina dell\'annuncio, dove ci sono tutte le informazioni.');
    }
    const app = ATS_INFO.find(a => a.re.test(location.href));
    if (app) {
      section(panel, 'Come ti candidi');
      panel.appendChild(el('div', 'font-size:12px;margin-top:2px', 'Programma usato dall\'azienda: ' + app.name));
      small(panel, app.what);
      for (const t of app.tips || []) small(panel, '→ ' + t);
    }
  }

  async function render(ctx) {
    const { site, company, title, key, result, companyInfo, app, adText } = ctx;
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
    const isAgency = companyInfo && companyInfo.agencySite;
    const reg = isAgency ? null : await store.get(regKey(company));
    for (const [pts, color, text] of registryCheck(reg, adText)) { score += pts; reasons.push([color, text]); }
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
    store.set('aflast', { title, company, site, score, level: level[0], label: level[1], time: Date.now() });

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
    if (reg) {
      small(panel, `Dati ufficiali (${reg.source}, letti il ${reg.date.split('-').reverse().join('/')}): ${registrySummary(reg)}`);
    } else if (!isAgency) {
      small(panel, 'Dati ufficiali non ancora letti: premi il pulsante qui sotto e apri la scheda dell\'azienda (stessa città e attività). Il riquadro li legge e li confronta con l\'annuncio.');
    }
    panel.appendChild(button('Dipendenti e fatturato ufficiali', () => { store.set('afpending', { company, time: Date.now() }); open(SEARCHES.registry(company)); }, 'Dati della Camera di Commercio (dipendenti dichiarati, fatturato, utile) su aziende.it, companyreports.it, ufficiocamerale.it'));
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

    // Come funziona la candidatura
    section(panel, 'Come ti candidi');
    if (app) {
      panel.appendChild(el('div', 'font-size:12px;margin-top:2px', `${app.kind === 'ats' ? 'Programma usato dall\'azienda: ' : ''}${app.name}`));
      small(panel, app.what);
      for (const t of app.tips || []) small(panel, '→ ' + t);
    } else {
      small(panel, 'Da questa pagina non si capisce con quale programma l\'azienda raccoglie le candidature.');
    }
    const more = el('details', 'margin-top:4px;font-size:12px;color:#555');
    more.appendChild(el('summary', 'cursor:pointer;color:#0a66c2', 'Cos\'è un ATS e come farsi leggere bene'));
    more.appendChild(el('div', 'margin-top:4px', ATS_GENERAL));
    more.appendChild(el('div', 'margin-top:4px', CV_TIPS));
    panel.appendChild(more);

    // Il tuo CV a confronto con l'annuncio
    section(panel, 'Il tuo CV e questo annuncio');
    const cv = await store.get('afcv');
    if (cv && cv.text) {
      const cmp = compareCv(adText || '', cv.text);
      if (!cmp.have.length && !cmp.miss.length) {
        small(panel, 'In questo annuncio non ho trovato parole chiave da confrontare.');
      } else {
        if (cmp.have.length) small(panel, '✓ Già nel tuo CV: ' + cmp.have.join(', '));
        if (cmp.miss.length) small(panel, '✗ Non nel tuo CV: ' + cmp.miss.join(', '));
        small(panel, 'Se queste cose le sai fare davvero, scrivile con le stesse parole dell\'annuncio. Non aggiungere quelle che non hai: al colloquio si vede.');
      }
      panel.appendChild(button('Cambia CV', () => { cvEditor(panel, cv.text, again); }, 'Incolla di nuovo il testo del tuo CV'));
    } else {
      small(panel, 'Incolla una volta il testo del tuo CV: su ogni annuncio vedrai quali parole chiave ti mancano. Il CV resta solo nel tuo browser.');
      panel.appendChild(button('Incolla il tuo CV', () => { cvEditor(panel, '', again); }));
    }

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
    if (REGISTRY_RE.test(location.hostname)) {
      const k = 'reg:' + location.pathname;
      if (k !== lastKey) { lastKey = k; registryMode(); }
      return;
    }
    if (isApplyFlow()) {
      const k = 'apply:' + location.hostname + location.pathname;
      if (k !== lastKey) { lastKey = k; renderApplyMode(); }
      return;
    }
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
      companyInfo: info.companyInfo,
      app: detectApplication(adapter, info.header || ''),
      adText: info.kwText || ((info.header || '') + '\n' + (info.body || ''))
    });
  }

  setInterval(tick, 1500);
  tick();
})();
