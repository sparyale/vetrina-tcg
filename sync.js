// Sincronizzazione con Google Drive: un file "vetrina-tcg.json" nel tuo Drive con collezione, master set,
// sigillato e impostazioni. Così iPhone e PC vedono gli stessi dati.
// Accesso Google con permesso "drive.file": l'app vede SOLO i file che crea lei, non il resto del tuo Drive.
// Serve un "ID client OAuth" Google (gratuito): si incolla in Impostazioni (vedi LEGGIMI, «Google Drive»).
const DRIVE = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FILE_NAME = 'vetrina-tcg.json';
  const LS = { token: 'vetrinaDriveToken', file: 'vetrinaDriveFile', sync: 'vetrinaDriveLastSync' };
  const ls = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* niente */ } }
  };
  const status = { state: 'off', msg: '', at: 0 }; // off | needLogin | syncing | ok | error
  const listeners = new Set();
  const setStatus = (state, msg = '') => { Object.assign(status, { state, msg, at: Date.now() }); listeners.forEach(f => f()); };
  let gisReady = null, tokenClient = null, pendingLogin = null;
  let hooks = null; // { getState, applyState, getUpdatedAt }

  const clientId = () => (hooks && hooks.clientId()) || (window.VETRINA_CONFIG && window.VETRINA_CONFIG.googleClientId) || '';
  const configured = () => !!clientId();
  const token = () => { const t = ls.get(LS.token); return t && t.exp > Date.now() + 60000 ? t.v : null; };

  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => resolve(); s.onerror = () => { gisReady = null; reject(new Error('gis')); };
      document.head.appendChild(s);
    });
    return gisReady;
  }
  // Accesso: va chiamato da un tocco/clic (Safari blocca le finestre aperte senza gesto dell'utente).
  async function login() {
    if (!configured()) throw new Error('noclient');
    // (script già precaricato all'avvio: niente attese prima della finestra, che Safari altrimenti blocca)
    if (!(window.google && google.accounts && google.accounts.oauth2)) await loadGis();
    if (!tokenClient || tokenClient._cid !== clientId()) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: SCOPE,
        callback: r => {
          const p = pendingLogin; pendingLogin = null;
          if (r && r.access_token) { ls.set(LS.token, { v: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 }); p && p.resolve(); }
          else p && p.reject(new Error((r && r.error) || 'login'));
        },
        error_callback: e => { const p = pendingLogin; pendingLogin = null; p && p.reject(new Error((e && e.type) || 'login')); }
      });
      tokenClient._cid = clientId();
    }
    return new Promise((resolve, reject) => { pendingLogin = { resolve, reject }; tokenClient.requestAccessToken({ prompt: '' }); });
  }
  function logout() {
    const t = token();
    if (t && window.google && google.accounts) try { google.accounts.oauth2.revoke(t, () => {}); } catch { /* niente */ }
    ls.set(LS.token, null); ls.set(LS.file, null); ls.set(LS.sync, null);
    setStatus('off');
  }

  async function api(url, opts = {}) {
    const t = token(); if (!t) throw new Error('needLogin');
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
    if (r.status === 401) { ls.set(LS.token, null); throw new Error('needLogin'); }
    if (!r.ok) throw new Error('http ' + r.status);
    return r;
  }
  async function fileId() {
    let id = ls.get(LS.file);
    if (id) return id;
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const j = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&spaces=drive`)).json();
    id = j.files && j.files[0] && j.files[0].id;
    if (id) ls.set(LS.file, id);
    return id || null;
  }
  async function download(id) {
    const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return r.json();
  }
  async function upload(data) {
    const body = JSON.stringify(data);
    let id = await fileId();
    if (id) {
      await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      return id;
    }
    const boundary = 'vtcg' + Math.random().toString(36).slice(2);
    const meta = { name: FILE_NAME, mimeType: 'application/json', description: 'NidoCollection: collezione Pokémon (non modificare a mano)' };
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const j = await (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart })).json();
    ls.set(LS.file, j.id);
    return j.id;
  }

  // Confronta i dati del dispositivo con quelli su Drive e tiene i più recenti.
  // conflict(): chiamata se sono cambiati entrambi dall'ultima sincronizzazione; deve rispondere 'local' o 'remote'.
  let busy = false, again = false;
  async function sync(conflict = hooks && hooks.conflict) {
    if (!hooks || !configured()) return;
    if (!token()) { setStatus('needLogin'); return; }
    if (busy) { again = true; return; }
    busy = true; setStatus('syncing');
    try {
      const last = ls.get(LS.sync) || 0;
      const localAt = hooks.getUpdatedAt() || 0;
      const id = await fileId();
      const remote = id ? await download(id).catch(() => null) : null;
      const remoteAt = remote && remote.updatedAt || 0;
      let pick = 'local';
      if (remote && remoteAt > localAt) pick = 'remote';
      // primo collegamento di questo dispositivo: se qui non c'è niente vince Drive; se ci sono dati in entrambi, chiede
      if (remote && !last) pick = hooks.isEmpty() ? 'remote' : conflict ? await conflict({ localAt, remoteAt, first: true }) : 'remote';
      // modificati entrambi dall'ultima sincronizzazione: chiede quale tenere
      else if (remote && last && remoteAt > last && localAt > last && remoteAt !== localAt && conflict) pick = await conflict({ localAt, remoteAt });
      if (pick === 'remote' && remote) { hooks.applyState(remote); ls.set(LS.sync, remoteAt); }
      else if (!remote || localAt > remoteAt || (pick === 'local' && localAt !== remoteAt)) {
        const data = { app: 'vetrina-tcg', v: 2, ...hooks.getState(), updatedAt: localAt || Date.now() };
        await upload(data); ls.set(LS.sync, data.updatedAt);
      } else ls.set(LS.sync, remoteAt);
      setStatus('ok');
    } catch (e) {
      setStatus(e.message === 'needLogin' ? 'needLogin' : 'error', e.message);
    } finally {
      busy = false;
      if (again) { again = false; setTimeout(() => sync(conflict), 500); }
    }
  }
  let pushT = null;
  // dopo ogni modifica: invio a Drive qualche secondo dopo (le modifiche ravvicinate partono insieme)
  function changed() {
    if (!hooks || !configured() || !ls.get(LS.sync)) return;
    if (!token()) { setStatus('needLogin'); return; }
    clearTimeout(pushT); pushT = setTimeout(() => sync(hooks.conflict), 4000);
  }
  return {
    init: h => { hooks = h; if (configured() && ls.get(LS.sync)) setStatus(token() ? 'ok' : 'needLogin'); if (configured()) loadGis().catch(() => {}); },
    preload: () => { if (configured()) loadGis().catch(() => {}); },
    configured, connected: () => !!token(), everSynced: () => !!ls.get(LS.sync), lastSync: () => ls.get(LS.sync),
    login, logout, sync, changed, status, onUpdate: f => { listeners.add(f); return () => listeners.delete(f); }
  };
})();
