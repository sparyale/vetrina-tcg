// Clic sull'icona dell'estensione: apre (o porta in primo piano) la scheda dell'app.
const APP_URL = chrome.runtime.getURL('index.html');

async function openApp() {
  const tabs = await chrome.tabs.query({ url: APP_URL + '*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
}
chrome.action.onClicked.addListener(openApp);

// ---------- aggiornamento automatico ----------
// L'estensione è caricata dalla cartella vetrina-tcg: quando i file cambiano (nuova versione in manifest.json)
// si ricarica da sola, senza dover premere ↻ in chrome://extensions, e riapre l'app se era aperta.
async function checkUpdate() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' });
    const disk = await r.json();
    if (disk.version && disk.version !== chrome.runtime.getManifest().version) {
      const tabs = await chrome.tabs.query({ url: APP_URL + '*' });
      await chrome.storage.local.set({ reopenApp: tabs.length > 0, reopenUrl: tabs[0] ? tabs[0].url : APP_URL });
      chrome.runtime.reload();
    }
  } catch { /* file in scrittura o non leggibile: riprova al prossimo controllo */ }
}

chrome.alarms.create('vetrina-update', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'vetrina-update') checkUpdate(); });
chrome.runtime.onMessage.addListener(msg => { if (msg && msg.type === 'vetrina-check-update') checkUpdate(); });

async function reopenAfterUpdate() {
  const { reopenApp, reopenUrl } = await chrome.storage.local.get(['reopenApp', 'reopenUrl']);
  if (!reopenApp) return;
  await chrome.storage.local.set({ reopenApp: false });
  const tabs = await chrome.tabs.query({ url: APP_URL + '*' });
  if (!tabs.length) await chrome.tabs.create({ url: reopenUrl || APP_URL });
}

chrome.runtime.onInstalled.addListener(d => {
  if (d.reason === 'install') chrome.tabs.create({ url: APP_URL });
  else reopenAfterUpdate();
});
chrome.runtime.onStartup.addListener(() => chrome.storage.local.set({ reopenApp: false }));
