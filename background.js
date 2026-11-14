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
// Aggiornamenti: controlla su GitHub se c'è una versione nuova e la installa da sola.
// Un'estensione può scrivere solo dentro la cartella Download. Per questo l'estensione va
// caricata una volta dalla cartella Download/annunci-fantasma: da lì in poi il pulsante
// Aggiorna sovrascrive i file in quella cartella, controlla che siano integri (SHA-256)
// e ricarica l'estensione e la pagina.
// ---------------------------------------------------------------------------
const VERSION_URL = 'https://raw.githubusercontent.com/Dmitrij-Anatolievic/annunci-fantasma/main/version.json';
const IS_FIREFOX = !!chrome.runtime.getManifest().browser_specific_settings;
const FOLDER = IS_FIREFOX ? 'annunci-fantasma-firefox' : 'annunci-fantasma';

function newer(a, b) { // true se la versione a è più recente di b
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

async function fetchVersion() {
  const r = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function checkUpdate(force) {
  const current = chrome.runtime.getManifest().version;
  const old = (await chrome.storage.local.get('afupdate')).afupdate;
  if (!force && old && old.current === current && Date.now() - old.checked < 12 * 3600 * 1000) return old;
  try {
    const v = await fetchVersion();
    const info = {
      current, latest: v.version, available: newer(v.version, current), notes: v.notes || [],
      url: IS_FIREFOX ? v.firefox : v.chrome, firefox: IS_FIREFOX, checked: Date.now(),
      auto: !!(IS_FIREFOX ? v.files_firefox : v.files_chrome)
    };
    await chrome.storage.local.set({ afupdate: info });
    return info;
  } catch (e) {
    return { current, error: 'Non riesco a raggiungere GitHub: controlla la connessione e riprova.', firefox: IS_FIREFOX };
  }
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function dataUrl(buf, path) {
  const type = /\.png$/.test(path) ? 'image/png' : /\.json$/.test(path) ? 'application/json' : 'text/plain';
  let bin = ''; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return 'data:' + type + ';base64,' + btoa(bin);
}

const BLOCKING_DANGER = ['file', 'url', 'content', 'uncommon', 'host', 'unwanted', 'promptForScanning', 'promptForLocalPasswordScanning', 'passwordProtected', 'blockedTooLarge', 'blockedScanFailed', 'sensitiveContentBlock', 'deepScannedOpenedDangerous', 'accountCompromise'];

// Un aggiornamento automatico non può dare all'estensione permessi nuovi: quelli vanno accettati a mano
function newPermissions(nextManifest) {
  const cur = chrome.runtime.getManifest();
  const list = m => [].concat(m.permissions || [], m.host_permissions || [], m.optional_permissions || [],
    ...(m.content_scripts || []).map(c => c.matches || []));
  const have = new Set(list(cur));
  return list(nextManifest).filter(p => !have.has(p));
}

// Aspetta la fine di uno scaricamento; segnala se il browser lo trattiene come "pericoloso"
function waitDownload(id) {
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (done) return; done = true; chrome.downloads.onChanged.removeListener(on); clearTimeout(t); resolve(r); };
    const check = () => chrome.downloads.search({ id }).then(([it]) => {
      if (!it) return;
      if (it.state === 'complete') finish({ ok: true, filename: it.filename });
      else if (it.state === 'interrupted') finish({ ok: false, reason: it.error || 'interrotto', filename: it.filename });
      // Solo gli stati che aspettano una decisione dell'utente sono un blocco; le scansioni in corso si aspettano
      else if (BLOCKING_DANGER.includes(it.danger)) finish({ ok: false, danger: true, filename: it.filename });
    });
    const on = d => { if (d.id === id) check(); };
    chrome.downloads.onChanged.addListener(on);
    const t = setTimeout(() => finish({ ok: false, reason: 'tempo scaduto' }), 30000);
    check();
  });
}

async function installUpdate(tabId) {
  const v = await fetchVersion();
  const current = chrome.runtime.getManifest().version;
  if (!newer(v.version, current)) return { ok: false, error: 'Hai già la versione più recente.' };
  const files = IS_FIREFOX ? v.files_firefox : v.files_chrome;
  const base = IS_FIREFOX ? v.base_firefox : v.base_chrome;
  if (!files || !base) return { ok: false, error: 'Questa versione si installa solo a mano.' };
  // 1) Scarica tutto in memoria e controlla l'impronta di ogni file prima di toccare il disco
  const got = [];
  for (const f of files) {
    const r = await fetch(base + f.path + '?v=' + v.version, { cache: 'no-store' });
    if (!r.ok) return { ok: false, error: 'GitHub non risponde (' + f.path + '). Riprova tra qualche minuto.' };
    const buf = await r.arrayBuffer();
    if (hex(await crypto.subtle.digest('SHA-256', buf)) !== f.sha256)
      return { ok: false, error: 'GitHub sta ancora pubblicando la nuova versione. Riprova tra qualche minuto.' };
    got.push({ path: f.path, buf });
  }
  const man = got.find(f => f.path === 'manifest.json');
  if (man) {
    let added = [];
    try { added = newPermissions(JSON.parse(new TextDecoder().decode(man.buf))); } catch (e) { return { ok: false, error: 'Il manifest della nuova versione non è leggibile.' }; }
    if (added.length) return { ok: false, error: 'La nuova versione chiede permessi nuovi (' + added.join(', ') + '): per sicurezza va installata a mano con lo zip' };
  }
  // 2) Scrive i file nella cartella Download/annunci-fantasma; manifest per ultimo
  got.sort((a, b) => (a.path === 'manifest.json') - (b.path === 'manifest.json'));
  let folder = '';
  for (const f of got) {
    const id = await chrome.downloads.download({ url: dataUrl(f.buf, f.path), filename: FOLDER + '/' + f.path, conflictAction: 'overwrite', saveAs: false });
    const res = await waitDownload(id);
    if (!res.ok) {
      if (res.danger) return { ok: false, error: 'Il browser ha trattenuto il file ' + f.path + '. Apri i download (Ctrl+J), premi "Mantieni" e poi di nuovo Aggiorna.' };
      return { ok: false, error: 'Scrittura di ' + f.path + ' non riuscita (' + res.reason + ').' };
    }
    const norm = res.filename.replace(/\\/g, '/');
    if (!norm.endsWith('/' + FOLDER + '/' + f.path))
      return { ok: false, error: 'Il browser ha salvato ' + f.path + ' con un altro nome invece di sovrascriverlo (' + norm.split('/').pop() + '). Controlla la cartella Download/' + FOLDER + '.' };
    if (f.path === 'manifest.json') folder = res.filename.replace(/[\\/]manifest\.json$/, '');
    chrome.downloads.erase({ id }).catch(() => {}); // toglie la voce dall'elenco download, il file resta
  }
  // 3) Se un file scritto è finito altrove (es. "manifest (1).json") il browser non ha sovrascritto
  if (!folder) return { ok: false, error: 'Il browser non ha sovrascritto i file: controlla la cartella Download/' + FOLDER + '.' };
  await chrome.storage.local.set({ afpendingupdate: { expected: v.version, from: current, folder, tabId, at: Date.now() } });
  return { ok: true, folder, version: v.version };
}

// Dopo la ricarica: la versione è cambiata? Se no, l'estensione è caricata da un'altra cartella.
async function afterReload() {
  const p = (await chrome.storage.local.get('afpendingupdate')).afpendingupdate;
  if (!p) return;
  const current = chrome.runtime.getManifest().version;
  const ok = current === p.expected;
  await chrome.storage.local.set({ afupdresult: { ok, version: current, expected: p.expected, folder: p.folder, at: Date.now() } });
  await chrome.storage.local.remove('afpendingupdate');
  if (p.tabId) chrome.tabs.reload(p.tabId).catch(() => {});
  checkUpdate(true);
}

chrome.runtime.onStartup.addListener(() => checkUpdate(false));
chrome.runtime.onInstalled.addListener(() => { afterReload().then(() => checkUpdate(true)); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'af-check-update') { checkUpdate(!!msg.force).then(sendResponse); return true; }
  if (msg.type === 'af-install-update') {
    installUpdate(sender.tab && sender.tab.id)
      .then(sendResponse, e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'af-download-update') { // ripiego: scarica lo zip
    checkUpdate(false).then(info => {
      if (!info || !info.url) { sendResponse({ ok: false, error: 'Nessun pacchetto da scaricare.' }); return; }
      chrome.downloads.download({ url: info.url, conflictAction: 'overwrite' })
        .then(id => sendResponse({ ok: true, id }), e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    });
    return true;
  }
  if (msg.type === 'af-update-result') {
    chrome.storage.local.get('afupdresult').then(r => sendResponse(r.afupdresult || null));
    return true;
  }
  if (msg.type === 'af-update-result-seen') { chrome.storage.local.remove('afupdresult'); return; }
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
  chrome.action.setTitle({ tabId, title: msg.score === '' ? 'Annunci Fantasma: analizza questo annuncio' : msg.score === 'STOP' ? 'Annunci Fantasma: STOP, non candidarti' : `Annunci Fantasma: punteggio di rischio ${msg.score}` });
});

// Cambiando pagina il badge della scheda si azzera
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' });
});
