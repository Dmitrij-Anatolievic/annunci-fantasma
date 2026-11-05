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
