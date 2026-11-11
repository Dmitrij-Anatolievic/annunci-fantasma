// Annunci Fantasma — service worker
// 1) Clic sull'icona: analizza la pagina corrente su qualsiasi sito (permesso "activeTab":
//    l'accesso vale solo per la scheda su cui clicchi e solo in quel momento).
// 2) Mostra il punteggio di rischio sull'icona (badge) della scheda analizzata.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    // Segna la richiesta manuale; se lo script è già attivo (LinkedIn, Indeed) forza una nuova analisi
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__AF_MANUAL = true;
        if (window.__AF_FORCE) window.__AF_FORCE();
      }
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    // Pagine interne di Chrome, Chrome Web Store, PDF: non analizzabili
    chrome.action.setBadgeText({ tabId: tab.id, text: '—' });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#9e9e9e' });
    chrome.action.setTitle({ tabId: tab.id, title: 'Annunci Fantasma: questa pagina non si può analizzare' });
  }
});

// ---------------------------------------------------------------------------
// Aggiornamenti: controlla su GitHub se c'è una versione nuova, la scarica e ricarica l'estensione.
// Un'estensione installata fuori dagli store non può sostituire da sola i propri file:
// lo scaricamento e la ricarica sono automatici, l'estrazione nella cartella la fai tu.
// ---------------------------------------------------------------------------
const VERSION_URL = 'https://raw.githubusercontent.com/Dmitrij-Anatolievic/annunci-fantasma/main/version.json';
const IS_FIREFOX = !!chrome.runtime.getManifest().browser_specific_settings;

function newer(a, b) { // true se la versione a è più recente di b
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

async function checkUpdate(force) {
  const current = chrome.runtime.getManifest().version;
  const old = (await chrome.storage.local.get('afupdate')).afupdate;
  if (!force && old && old.current === current && Date.now() - old.checked < 12 * 3600 * 1000) return old;
  try {
    const r = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const v = await r.json();
    const info = {
      current, latest: v.version, available: newer(v.version, current), notes: v.notes || [],
      url: IS_FIREFOX ? v.firefox : v.chrome, firefox: IS_FIREFOX, checked: Date.now()
    };
    await chrome.storage.local.set({ afupdate: info });
    return info;
  } catch (e) {
    return { current, error: 'Non riesco a raggiungere GitHub: controlla la connessione e riprova.', firefox: IS_FIREFOX };
  }
}

chrome.runtime.onStartup.addListener(() => checkUpdate(false));
chrome.runtime.onInstalled.addListener(() => checkUpdate(true));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'af-check-update') { checkUpdate(!!msg.force).then(sendResponse); return true; }
  if (msg.type === 'af-download-update') {
    checkUpdate(false).then(info => {
      if (!info || !info.url) { sendResponse({ ok: false, error: 'Nessun pacchetto da scaricare.' }); return; }
      chrome.downloads.download({ url: info.url, conflictAction: 'overwrite' })
        .then(id => sendResponse({ ok: true, id }), e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    });
    return true;
  }
  if (msg.type === 'af-reload') { chrome.runtime.reload(); return; }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'af-score' || !sender.tab) return;
  const tabId = sender.tab.id;
  if (msg.score === null) { // modulo di candidatura: nessun punteggio
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Annunci Fantasma: candidatura in corso' });
    return;
  }
  chrome.action.setBadgeText({ tabId, text: String(msg.score) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: msg.color || '#9e9e9e' });
  chrome.action.setTitle({ tabId, title: msg.score === '' ? 'Annunci Fantasma: analizza questo annuncio' : `Annunci Fantasma: punteggio di rischio ${msg.score}` });
});

// Cambiando pagina il badge della scheda si azzera
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' });
});
