// NidoCollection (ex Vetrina TCG) — interfaccia
'use strict';

const S = {
  settings: { uiLang: 'it', cardLang: 'it', currency: 'EUR', source: 'cm_trend', ebayDomain: 'ebay.it', theme: 'dark', view: 'grid', sort: 'value' },
  items: [],
  masters: [],        // master set seguiti: { id, lang, setId, setName, logo, special, createdAt }
  sealed: [],         // prodotti sigillati
  portfolio: [],      // [[aaaa-mm-gg, valore EUR]]
  rates: { EUR: 1, USD: 1.1, JPY: 170, GBP: 0.84 },
  search: { q: '', lang: null, results: [], shown: 60, loading: false, error: null },
  sets: { lang: null, list: [], filter: '' },
  setView: null,
  colFilter: { q: '', set: '', lang: '' },
  refreshing: false
};

const CARD_LANGS = ['it', 'en', 'ja', 'fr', 'de', 'es', 'pt'];
const CONDS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
// versione mostrata in Impostazioni (uguale a manifest.json): serve a capire se l'estensione è stata ricaricata
const APP_VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '1.7.0';
const GRADERS = ['PSA', 'BGS', 'CGC', 'AiGrading', 'GRAAD', 'TAG', 'ACE', 'SGC', 'PCA'];
const SOURCES = ['ebay_auto', 'cm_trend', 'cm_avg30', 'cm_low', 'ebay', 'manual'];
const LANG_BADGE = { it: 'ITA', en: 'ENG', ja: 'JPN', fr: 'FRA', de: 'DEU', es: 'ESP', pt: 'POR' };

// ---------- utilità ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = k => (I18N[S.settings.uiLang] && I18N[S.settings.uiLang][k]) || I18N.it[k] || k;
const locale = () => ({ it: 'it-IT', en: 'en-GB', ja: 'ja-JP' }[S.settings.uiLang] || 'it-IT');
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

function money(eur, opts = {}) {
  if (eur == null || !isFinite(eur)) return '—';
  const cur = S.settings.currency;
  const v = eur * (S.rates[cur] || 1);
  const digits = cur === 'JPY' ? 0 : (opts.compact && Math.abs(v) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
const toEur = (v, cur) => (v == null ? null : !cur || cur === 'EUR' ? v : v / (S.rates[cur] || 1));
function pct(v) {
  if (v == null || !isFinite(v)) return '';
  const s = (v > 0 ? '+' : '') + (v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0) + '%';
  return `<span class="chg ${v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : ''}">${s}</span>`;
}
function fmtDate(d) { if (!d) return ''; try { return new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } }
// base TCGdex ("https://assets.tcgdex.net/...") oppure immagine dal database locale ("ext:l:..." / "ext:s:...")
const img = (base, q = 'low') => (!base ? '' : base.startsWith('ext:') ? API.extUrl(base.slice(4), q) : `${base}/${q}.webp`);
const FINISH_LABEL = { pokeball: 'Poké Ball', masterball: 'Master Ball', cosmos: 'Cosmo', cosmo: 'Cosmo', stampsetlogo: 'Logo set', stamplogoset: 'Logo set',
  shadowless: 'Shadowless', shadowless1st: 'Shadowless', print1999: '1999-2000 (ristampa UK)' };
// nomi dei timbri di TCGdex (player-rewards-program) resi leggibili (Player Rewards Program)
const prettyStamp = x => x && /^[a-z0-9\-\s]+$/.test(x) ? x.split(/[-\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : x;
const finishLabel = (f, fallback) => FINISH_LABEL[f] || prettyStamp(fallback) || (f ? f.replace(/^stamp/, 'Stamp ') : '');
// carte che esistono anche in 1ª edizione (has1st): le altre versioni sono "Unlimited"
// (tranne Shadowless e ristampa 1999-2000 del Set Base, che hanno il loro nome)
const isUnlimited = it => !!(it && it.has1st && it.variant !== 'firstEdition' && !/^shadowless|^print1999$/.test(it.finish || ''));
const variantLabel = it => t('variant_' + (it.variant || 'normal')) + (isUnlimited(it) ? ' · Unlimited' : '') + (it.finish ? ' · ' + finishLabel(it.finish, it.finishLabel) : '');
const isPlain = it => (!it.variant || it.variant === 'normal') && !it.finish && !isUnlimited(it);
// Classic Collection del 30°: ristampe, numerate come su Cardmarket con la carta originale (es. "30C SSH 138")
const CLASSIC_PREFIX = { '30th-c': '30C' };
const classicNum = it => {
  const id = it && (it.cardId || it.id);
  const set = id && Object.keys(CLASSIC_PREFIX).find(s => id.startsWith(s + '-'));
  return set && CLASSIC_ORIG[id] ? `${CLASSIC_PREFIX[set]} ${CLASSIC_ORIG[id]}` : null;
};
const numLabel = it => classicNum(it) || (!it.localId ? '' : it.official ? `${it.localId}/${String(it.official).padStart(String(it.localId).length, '0')}` : `#${it.localId}`);

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2700);
}

// ---------- prezzi ----------
function unitValue(it) {
  const src = it.source && it.source !== 'auto' ? it.source : (it.grade && it.grade.co ? 'ebay' : S.settings.source);
  const cm = it.cm || {};
  const tcg = tcgEur(it); // TCGplayer: ultima risorsa, quando Cardmarket non ha prezzi
  const order = {
    cm_trend: [cm.trend, cm.avg7, cm.avg30, cm.avg, tcg],
    cm_avg30: [cm.avg30, cm.trend, cm.avg, tcg],
    // minimo Cardmarket: quello nella LINGUA della carta (NM); il "Da" del listino è di tutte le lingue
    // e si usa solo per le carte che non sono di catalogo TCGdex (niente pagina da leggere)
    cm_low: [it.cmMin && it.cmMin.v === CMMIN.V && it.cmMin.p > 0 ? it.cmMin.p : null, cm.idProduct && (!it.db || it.db === 'tcgdex') ? null : cm.low, cm.trend, tcg],
    // mediana dei venduti eBay (con la lingua della carta) per le carte sopra 3 €, altrimenti tendenza Cardmarket
    // senza vendite eBay: minimo Cardmarket nella lingua (NM), letto dalla pagina della carta
    // (una mediana lontanissima dalla tendenza Cardmarket è scartata: annunci di un'altra carta)
    ebay_auto: [worthEbay(cm, tcg) && it.ebay && it.ebay.count && ebayOk(it.ebay.median, cm, tcg) ? it.ebay.median : null, worthEbay(cm, tcg) && it.cmMin && it.cmMin.v === CMMIN.V && ebayOk(it.cmMin.p, cm, tcg) ? it.cmMin.p : null, cm.trend, cm.avg30, cm.low, tcg],
    // gradata senza vendite: meglio il prezzo scritto a mano che quello della carta non gradata
    ebay: [it.ebay && it.ebay.median, it.grade && it.grade.co ? it.manualPrice : null, cm.trend, cm.avg30],
    manual: [it.manualPrice, cm.trend]
  }[src] || [cm.trend];
  if (it.manualPrice != null && src === 'manual') return it.manualPrice;
  const v = order.find(x => x != null && x > 0);
  return v != null ? v : (it.manualPrice != null ? it.manualPrice : null);
}
const effSource = it => (it.source && it.source !== 'auto' ? it.source : (it.grade && it.grade.co ? 'ebay' : S.settings.source));
// La mediana eBay si cerca solo per le carte che valgono più di 3 € (prezzo tipico Cardmarket):
// sotto quella cifra basta la tendenza Cardmarket, e la lettura di un set resta veloce.
const EBAY_FROM = 3;
// I prezzi trovati (venduti eBay, minimo Cardmarket) valgono 2 mesi: aprendo l'app non si rifanno le ricerche.
// Prima si possono ricontrollare a mano con il pulsante (master set o ↻ in alto).
const PRICE_TTL = 60 * 864e5;
// (tcg: prezzo TCGplayer in euro, usato solo se Cardmarket non ha prezzi)
const worthEbay = (cm, tcg) => ((cm && (cm.trend || cm.avg30 || cm.low)) || tcg || 0) > EBAY_FROM;
// it.tcgp = prezzo TCGplayer in dollari (dalla scheda TCGdex), convertito al cambio del giorno
const tcgEur = it => (it && it.tcgp > 0 ? toEur(it.tcgp, 'USD') : null);
// Controllo di plausibilità: se la mediana eBay è più di 4 volte sopra (o sotto) la tendenza Cardmarket,
// quasi sempre la ricerca ha preso annunci di un'altra carta (es. l'originale al posto della ristampa).
const EBAY_SANE = 4;
const ebayOk = (m, cm, tcg) => {
  const ref = (cm && (cm.trend || cm.avg30 || cm.avg7)) || tcg;
  return m == null || !ref || (m <= ref * EBAY_SANE && m >= ref / EBAY_SANE);
};
// Versione dei filtri sugli annunci eBay: se cambia, le mediane salvate si ricalcolano.
const EBAY_FV = 2;

// Coda delle ricerche eBay in background (una per volta). Per ogni versione di carta
// (lingua · carta · variante · motivo) ricorda mediana e numero di vendite per 3 giorni.
const EBQ = (() => {
  let cache = {};
  const ready = DB.get('eb_med').then(v => { cache = v || {}; }).catch(() => {});
  const TTL = PRICE_TTL;
  const keyOf = d => [d.lang, d.cardId, d.variant || 'normal', d.finish || ''].join('|');
  const get = d => cache[keyOf(d)] || null;
  // valida solo se fatta di recente e con la ricerca di adesso (es. dopo un cambio del modo di cercare)
  const fresh = d => { const c = get(d); return !!(c && Date.now() - c.at < TTL && c.fv === EBAY_FV && (!c.q || c.q === ebayQuery(d))); };
  const queue = [], queued = new Map();
  const status = { state: 'idle', msg: '', at: 0 };
  let running = false, saveT = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // query: ricerca da usare (per le carte in collezione rispetta quella scritta a mano)
  function want(d, query, force = false) {
    if (!EBAY.isExt) return Promise.resolve(null);
    if (!force && fresh(d)) return Promise.resolve(null);
    const k = keyOf(d);
    if (queued.has(k)) return queued.get(k);
    let res; const p = new Promise(r => (res = r));
    queued.set(k, p); queue.push({ d, k, query: query || ebayQuery(d), res });
    run();
    return p;
  }
  async function run() {
    if (running) return; running = true;
    await ready;
    while (queue.length) {
      const j = queue.shift();
      Object.assign(status, { state: 'reading', at: Date.now() });
      let eb;
      try { eb = await ebayLookup(j.query, j.d, 'card', { silent: true }); } catch (e) { eb = { error: e.message || 'failed' }; }
      queued.delete(j.k);
      if (eb.error) {
        Object.assign(status, { state: 'error', msg: eb.error, at: Date.now() });
        j.res(null);
        if (eb.error === 'login') { toast(t('ebayLogin')); queue.splice(0).forEach(x => { queued.delete(x.k); x.res(null); }); break; }
        await sleep(3000); continue;
      }
      cache[j.k] = { m: eb.median ?? null, n: eb.count || 0, at: Date.now(), q: j.query, fv: EBAY_FV };
      eb.fv = EBAY_FV;
      clearTimeout(saveT); saveT = setTimeout(() => DB.set('eb_med', cache), 1000);
      j.res(eb);
      softRender();
      await sleep(1500);
    }
    running = false;
    if (status.state === 'reading') status.state = 'idle';
    softRender();
  }
  return { ready, get, fresh, want, status, get pending() { return queue.length; } };
})();
let softT = null;
function softRender() {
  clearTimeout(softT);
  softT = setTimeout(() => {
    if (M) return; // non toccare la scheda aperta
    const r = route().name;
    if (['dashboard', 'collection', 'wishlist', 'master'].includes(r)) { const y = scrollY; render(); scrollTo(0, y); }
  }, 1200);
}
function ebqStatusHtml() {
  const st = EBQ.status, cs = CMMIN.status;
  let h = '';
  if (st.state === 'error' && Date.now() - st.at < 10 * 6e4) h += ` · <span class="neg">${t('ebq_error')}: ${esc(st.msg)}</span>`;
  if (CMMIN.pending) h += ` · <span class="spinner sm"></span> ${t('cmmin_reading').replace('{n}', CMMIN.pending)}`;
  if (cs.state === 'challenge') h += ` · <b class="neg">${t('cmmin_challenge')}</b>`;
  else if (cs.state === 'error' && Date.now() - cs.at < 10 * 6e4) h += ` · <span class="neg">${t('cmmin_error')}: ${esc(cs.msg)}</span>`;
  return h;
}
CMMIN.onUpdate(() => softRender());
// Filtri della pagina Cardmarket per questa versione: reverse sì/no, 1ª edizione sì/no
function minOpt(card, s) {
  if (s.finish) return {};
  const vs = card ? API.slotsForCard(card, true) : [];
  // reverse da filtrare solo se la carta esiste sia normale/holo sia reverse
  const both = vs.some(x => x.variant === 'reverse' && !x.finish) && vs.some(x => x.variant !== 'reverse' && !x.finish);
  return {
    reverse: !both ? undefined : s.variant === 'reverse',
    first: s.variant === 'firstEdition' ? true : (s.has1st || vs.some(x => x.variant === 'firstEdition')) ? false : undefined
  };
}
// Nessuna vendita eBay: in alternativa legge il minimo Cardmarket nella lingua della carta (in coda).
function wantCmMin(it, force = false) {
  const id = it.cm && it.cm.idProduct;
  if (!id || !CMMIN.isExt) return;
  const o = it.cmOpt || {};
  CMMIN.want(id, it.lang, o, force).then(v => {
    if (!v) return;
    const cur = S.items.find(x => x.uid === it.uid); if (!cur) return;
    cur.cmMin = v; saveAuto(); softRender();
  });
}
const itemValue = it => { const u = unitValue(it); return u == null ? null : u * (it.qty || 1); };
const change7 = it => (it.cm && it.cm.avg7 && it.cm.avg30 ? it.cm.avg7 / it.cm.avg30 - 1 : null);
const collection = () => S.items.filter(i => i.list !== 'wishlist');
const wishlist = () => S.items.filter(i => i.list === 'wishlist');

function totals(list = collection()) {
  let value = 0, cost = 0, costKnownValue = 0, cards = 0;
  const uniq = new Set(), sets = new Set();
  list.forEach(i => {
    const v = itemValue(i) || 0;
    value += v; cards += i.qty || 1;
    uniq.add(i.lang + i.cardId); sets.add(i.lang + i.setId);
    if (i.buyPrice != null) { cost += i.buyPrice * (i.qty || 1); costKnownValue += v; }
  });
  return { value, cost, gain: cost ? costKnownValue - cost : null, gainPct: cost ? costKnownValue / cost - 1 : null, cards, unique: uniq.size, sets: sets.size };
}

// valore di un prodotto sigillato (EUR, cadauno)
function sealedUnit(p) {
  if (p.source === 'cm' && p.cm && (p.cm.trend || p.cm.avg30)) return p.cm.trend || p.cm.avg30;
  if (p.source === 'ebay' && p.ebay && p.ebay.median) return p.ebay.median;
  if (p.value != null) return p.value;
  return p.ebay && p.ebay.median ? p.ebay.median : null;
}
function sealedTotals() {
  let value = 0, cost = 0, costKnownValue = 0, n = 0;
  S.sealed.forEach(p => {
    const v = (sealedUnit(p) || 0) * (p.qty || 1);
    value += v; n += p.qty || 1;
    if (p.buyPrice != null) { cost += p.buyPrice * (p.qty || 1); costKnownValue += v; }
  });
  return { value, cost, costKnownValue, n };
}

// ---------- salvataggio ----------
let saveTimer = null;
// S.editedAt: ultima modifica fatta da te (aggiunte, modifiche, valori…). Decide quale copia vince tra questo
// dispositivo e Google Drive. Gli aggiornamenti automatici dei prezzi usano saveAuto(): salvano ma non contano
// come modifica, così l'avvio dell'app su un altro dispositivo non sovrascrive quello che hai fatto qui.
function writeState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    DB.set('state', { settings: S.settings, items: S.items, masters: S.masters, sealed: S.sealed, portfolio: S.portfolio, editedAt: S.editedAt || 0, v: 1 });
  }, 200);
}
function save() { S.editedAt = Date.now(); writeState(); DRIVE.changed(); }
function saveAuto() { writeState(); }
// dati da sincronizzare (le impostazioni legate al dispositivo restano locali)
const DEVICE_SETTINGS = ['theme', 'view'];
const syncState = () => ({ settings: Object.fromEntries(Object.entries(S.settings).filter(([k]) => !DEVICE_SETTINGS.includes(k))),
  items: S.items, masters: S.masters, sealed: S.sealed, portfolio: S.portfolio });
function applySyncState(d) {
  if (!d || !Array.isArray(d.items)) return;
  const keep = Object.fromEntries(DEVICE_SETTINGS.map(k => [k, S.settings[k]]));
  Object.assign(S.settings, d.settings || {}, keep);
  S.items = fixImgs(d.items); S.masters = d.masters || []; S.sealed = d.sealed || []; S.portfolio = d.portfolio || [];
  S.editedAt = d.updatedAt || Date.now();
  masterCache.clear(); writeState(); render();
  toast(t('drive_pulled'));
}
// immagini Scrydex salvate (per alcune carte era solo il retro, es. Classic Collection): si tolgono e si ricalcolano
const fixImgs = items => { (items || []).forEach(i => { if (/^ext:s:/.test(i.image || '')) i.image = null; }); return items; };
async function load() {
  const st = await DB.get('state');
  if (st) {
    S.editedAt = st.editedAt || 0;
    Object.assign(S.settings, st.settings || {});
    S.items = fixImgs(st.items || []);
    S.portfolio = st.portfolio || [];
    S.masters = st.masters || [];
    S.sealed = st.sealed || [];
    // TCGplayer (mercato USA) non è più una fonte
    if (S.settings.source === 'tcg') S.settings.source = 'cm_trend';
    S.items.forEach(i => { if (i.source === 'tcg') i.source = 'auto'; delete i.tcg; });
    // carte dei master set seguiti: valore = mediana venduti eBay (sopra 3 €), altrimenti tendenza Cardmarket
    const ms = new Set(S.masters.flatMap(m => [m.lang + '|' + m.setId, ...(MASTER_EXTRA[m.setId] || []).map(id => m.lang + '|' + id)]));
    S.items.forEach(i => {
      if (i.source === 'cm_minlang') i.source = 'ebay_auto';
      else if ((!S.settings.ebayAutoMigrated || (!S.settings.ebayAutoExtra && /^30th-c$/.test(i.setId))) && ms.has(i.lang + '|' + i.setId) && (!i.source || i.source === 'auto') && !(i.grade && i.grade.co)) { i.source = 'ebay_auto'; i.masterId = i.lang + '|' + i.setId; }
    });
    if (S.settings.source === 'cm_minlang') S.settings.source = 'ebay_auto';
    S.settings.ebayAutoMigrated = true; S.settings.ebayAutoExtra = true;
    // stima eBay del master set rimasta "in corso" (app chiusa durante la ricerca)
    // (stima automatica eBay tolta: il valore del master set lo scrivi tu)
    S.masters.forEach(m => { delete m.estLoading; delete m.est; if (m.stats) { m.stats.est = m.value > 0 ? m.value : null; m.stats.value = m.stats.est; } });
    // carte aggiunte dal master set con la mediana eBay automatica: tornano alla fonte scelta in Impostazioni
    // (la ricerca eBay carta per carta in background faceva scattare i controlli anti-bot)
    if (!S.settings.noMassEbay) {
      S.items.forEach(i => { if (i.source === 'ebay_auto' && i.masterId) i.source = 'auto'; });
      S.settings.noMassEbay = true;
    }
    // master set di un set incluso in un altro (Classic Collection seguita a parte): unito al master principale
    S.masters = S.masters.flatMap(m => {
      const parent = masterParent(m.setId);
      if (!parent) return [m];
      if (S.masters.some(x => x.lang === m.lang && x.setId === parent)) return [];
      return [{ ...m, setId: parent, setName: '', logo: '', stats: null }];
    });
  } else {
    const nl = (navigator.language || 'it').slice(0, 2);
    if (I18N[nl]) S.settings.uiLang = nl;
    if (CARD_LANGS.includes(nl)) S.settings.cardLang = nl;
  }
}

function snapshotPortfolio() {
  const d = today();
  const v = Math.round((totals().value + sealedTotals().value) * 100) / 100;
  const last = S.portfolio[S.portfolio.length - 1];
  if (last && last[0] === d) last[1] = v; else S.portfolio.push([d, v]);
  if (S.portfolio.length > 1500) S.portfolio.shift();
}

function applyCardData(it, card) {
  const p = API.pricing(card, it.variant, it.finish);
  it.cm = p.cm; delete it.tcg; it.tcgp = p.tcg || null; it.pricesAt = Date.now();
  if (card.image && !it.image) it.image = card.image;
  if (card.rarity) it.rarity = card.rarity;
  it.has1st = API.slotsForCard(card, true).some(s => s.variant === 'firstEdition');
  it.cmOpt = minOpt(card, it);
  const u = unitValue(it);
  if (u != null) {
    it.history = it.history || [];
    const last = it.history[it.history.length - 1];
    if (last && last[0] === today()) last[1] = u; else it.history.push([today(), u]);
    if (it.history.length > 730) it.history.shift();
  }
}

async function refreshPrices(force = false) {
  if (S.refreshing) return;
  // carte e sigillato dal catalogo Cardmarket (solo estensione)
  if (CM.canLoad && (S.items.some(i => i.db === 'cm') || S.sealed.some(p => p.cmId))) {
    if (await CM.load()) {
      S.items.filter(i => i.db === 'cm').forEach(i => { const c = CM.priceOf(i.cmId, i.variant === 'reverse'); if (c) { i.cm = c; i.pricesAt = Date.now(); } });
      S.sealed.filter(p => p.cmId).forEach(p => { const c = CM.priceOf(p.cmId, false); if (c) p.cm = c; });
    }
  }
  const stale = S.items.filter(i => (!i.db || i.db === 'tcgdex') && (force || !i.pricesAt || Date.now() - i.pricesAt > 12 * 36e5));
  if (!stale.length) { if (force) { S.settings.pricesScanAt = Date.now(); snapshotPortfolio(); save(); render(); } else { snapshotPortfolio(); saveAuto(); } return; }
  S.refreshing = true; renderRefreshState();
  const keys = [...new Set(stale.map(i => i.lang + '|' + i.cardId))];
  let idx = 0, failed = 0;
  async function worker() {
    while (idx < keys.length) {
      const k = keys[idx++];
      const [lang, id] = k.split('|');
      try {
        const card = await API.getCard(lang, id);
        if (card) S.items.filter(i => i.lang === lang && i.cardId === id).forEach(i => applyCardData(i, card));
      } catch { failed++; }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  S.refreshing = false;
  // (niente ricerche eBay/Cardmarket per tutte le carte insieme: si fanno una alla volta aprendo la carta)
  if (force) S.settings.pricesScanAt = Date.now();
  snapshotPortfolio(); if (force) save(); else saveAuto();
  if (failed) toast(t('offline'));
  render();
}
// Carte valutate con la mediana eBay (sopra 3 €): rifà la ricerca dei venduti se è più vecchia di 3 giorni.
// Carte con fonte "minimo Cardmarket": legge il minimo nella lingua della carta (valido 2 mesi).
function refreshLowLang(force = false) {
  if (!CMMIN.isExt) return;
  collection().filter(i => effSource(i) === 'cm_low' && (!i.db || i.db === 'tcgdex') && !(i.grade && i.grade.co) && i.cm && i.cm.idProduct &&
    (force || !(i.cmMin && i.cmMin.v === CMMIN.V && Date.now() - i.cmMin.at < PRICE_TTL))).forEach(i => wantCmMin(i, force));
}
// force: ricontrollo chiesto con il pulsante ↻ (rifà tutte le ricerche, anche quelle recenti)
function refreshAutoEbay(force = false) {
  if (!EBAY.isExt) return;
  const auto = collection().filter(i => effSource(i) === 'ebay_auto' && !(i.grade && i.grade.co) && worthEbay(i.cm, tcgEur(i)));
  // già cercate su eBay senza vendite: minimo Cardmarket in alternativa
  // (o con una mediana non plausibile)
  if (!force) auto.filter(i => i.ebay && i.ebay.at && (!i.ebay.count || !ebayOk(i.ebay.median, i.cm, tcgEur(i))) && i.ebay.query === ebayQ(i) && !(i.cmMin && i.cmMin.v === CMMIN.V && Date.now() - i.cmMin.at < PRICE_TTL)).forEach(i => wantCmMin(i));
  auto.filter(i => force || !i.ebay || !i.ebay.at || Date.now() - i.ebay.at > PRICE_TTL || i.ebay.query !== ebayQ(i) || i.ebay.fv !== EBAY_FV).forEach(i => {
    EBQ.want(i, ebayQ(i), true).then(eb => {
      if (!eb) return;
      const cur = S.items.find(x => x.uid === i.uid); if (!cur) return;
      // ricerca fatta dall'app: non è "scritta a mano" (altrimenti resterebbe bloccata su questa)
      cur.ebay = { ...eb, custom: ebayQ(i) !== ebayQuery(i) };
      if (!eb.count || !ebayOk(eb.median, cur.cm, tcgEur(cur))) wantCmMin(cur, force);
      const u = unitValue(cur);
      if (u != null) { cur.history = cur.history || []; const l = cur.history[cur.history.length - 1]; if (l && l[0] === today()) l[1] = u; else cur.history.push([today(), u]); }
      saveAuto();
    });
  });
}
function renderRefreshState() {
  document.querySelectorAll('.scanbtn').forEach(b => { b.classList.toggle('spin', S.refreshing); b.disabled = !!S.refreshing; b.title = S.refreshing ? t('refreshing') : t('refreshPrices'); });
}
const isMobile = () => matchMedia('(max-width: 760px)').matches;
// pulsante «Scansiona prezzi» (+ data dell'ultima scansione)
function scanBtnHtml(cls = '') {
  return `<button class="btn scanbtn ${cls} ${S.refreshing ? 'spin' : ''}" data-act="refresh" title="${esc(S.refreshing ? t('refreshing') : t('refreshPrices'))}" ${S.refreshing ? 'disabled' : ''}>${icon('refresh')}<span>${t('scan_btn')}</span></button>`;
}
const scanWhen = () => S.settings.pricesScanAt ? t('scan_last').replace('{d}', new Date(S.settings.pricesScanAt).toLocaleDateString(locale())) : t('scan_never');

// ---------- struttura ----------
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  collection: '<path d="M4 6H2v14a2 2 0 0 0 2 2h14v-2H4zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H8V4h12z"/>',
  search: '<path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/>',
  sets: '<path d="M12 2 2 7l10 5 10-5zm0 13L4.2 11.1 2 12.2l10 5 10-5-2.2-1.1zm0 5L4.2 16.1 2 17.2l10 5 10-5-2.2-1.1z"/>',
  wishlist: '<path d="m12 21.4-1.5-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.5 11.5z"/>',
  settings: '<path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>',
  refresh: '<path d="M17.6 6.4A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z"/>',
  cloud: '<path d="M19.4 10A7 7 0 0 0 6.3 8.1 5.5 5.5 0 0 0 6.5 19H19a4.5 4.5 0 0 0 .4-9zM19 17H6.5a3.5 3.5 0 0 1-.2-7l.7-.1.3-.6a5 5 0 0 1 9.4 1.5l.2 1.2H19a2.5 2.5 0 0 1 0 5z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>',
  close: '<path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/>',
  ext: '<path d="M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"/>',
  grid: '<path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>',
  list: '<path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z"/>',
  master: '<path d="M19 5h-2V3H7v2H5a2 2 0 0 0-2 2v1a5 5 0 0 0 4.4 5 5 5 0 0 0 3.6 2.9V19H8v2h8v-2h-3v-3.1A5 5 0 0 0 16.6 13 5 5 0 0 0 21 8V7a2 2 0 0 0-2-2zM5 8V7h2v3.8A3 3 0 0 1 5 8zm14 0a3 3 0 0 1-2 2.8V7h2z"/>',
  sealed: '<path d="M21 7.5 12 3 3 7.5v9L12 21l9-4.5zM12 5.2 17.6 8 12 10.8 6.4 8zM5 9.6l6 3v6.1l-6-3zm8 9.1v-6.1l6-3v6.1z"/>',
  check: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  heart: '<path d="M16.5 3c-1.7 0-3.4.8-4.5 2.1C10.9 3.8 9.2 3 7.5 3 4.4 3 2 5.4 2 8.5c0 3.8 3.4 6.9 8.6 11.5l1.4 1.3 1.4-1.3C18.6 15.4 22 12.3 22 8.5 22 5.4 19.6 3 16.5 3zm-4.4 15.5-.1.1-.1-.1C7.1 14.2 4 11.4 4 8.5 4 6.5 5.5 5 7.5 5c1.5 0 3 1 3.6 2.4h1.9C13.5 6 15 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.9-3.1 5.7-7.9 10z"/>'
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

function route() {
  const def = isMobile() ? 'collection' : 'dashboard';
  const h = (location.hash || '#/' + def).slice(2).split('/');
  return { name: h[0] || def, args: h.slice(1).map(decodeURIComponent) };
}
function go(path) { location.hash = '#/' + path; }

function shell() {
  const r = route().name;
  const nav = ['dashboard', 'collection', 'search', 'sets', 'master', 'sealed', 'wishlist', 'settings'];
  const tabs = ['collection', 'search', 'master', 'sealed', 'dashboard'];
  const mob = isMobile();
  document.documentElement.lang = S.settings.uiLang;
  document.documentElement.dataset.theme = S.settings.theme;
  $('#app').innerHTML = `
  <aside class="side">
    <div class="brand"><div class="logo">${logoSvg()}</div><div><div class="brand-name">NidoCollection</div><div class="brand-sub">${t('appSubtitle')}</div></div></div>
    <nav>${nav.map(n => `<a href="#/${n}" class="nav ${r === n ? 'on' : ''}">${icon(n)}<span>${t('nav_' + n)}</span>${n === 'wishlist' && wishlist().length ? `<em>${wishlist().length}</em>` : ''}</a>`).join('')}</nav>
    <div class="side-foot">
      <div class="seg" role="group" aria-label="${t('settings_ui')}">${['it', 'en', 'ja'].map(l => `<button data-act="ui-lang" data-v="${l}" class="${S.settings.uiLang === l ? 'on' : ''}">${{ it: 'IT', en: 'EN', ja: '日本' }[l]}</button>`).join('')}</div>
    </div>
  </aside>
  <main class="main">
    <header class="top">
      ${mob ? `<form class="gsearch" data-form="gsearch">${icon('search')}<input name="q" type="search" data-cf="q" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(t('searchOwned'))}" value="${esc(S.colFilter.q)}"></form>`
        : `<form class="gsearch" data-form="gsearch">${icon('search')}<input name="q" autocomplete="off" placeholder="${esc(t('searchPlaceholder'))}" value="${esc(S.search.q)}"></form>
      ${scanBtnHtml('desk-only')}`}
      ${driveBtnHtml()}
      <a href="#/settings" class="iconbtn mobile-only ${r === 'settings' ? 'on' : ''}" title="${t('nav_settings')}">${icon('settings')}</a>
      <select class="cur" data-set="currency" aria-label="${t('settings_currency')}">${['EUR', 'USD', 'GBP', 'JPY'].map(c => `<option ${S.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </header>
    <section id="view" class="view"></section>
  </main>
  <nav class="tabbar">${tabs.map(n => `<a href="#/${n}" class="${r === n ? 'on' : ''}">${icon(n)}<span>${t((n === 'search' ? 'tab_' : 'nav_') + n)}</span></a>`).join('')}</nav>
  <div id="modal"></div><div id="toasts"></div>`;
}

// Pulsante Google Drive in alto: compare solo se Drive è collegato; tocca per sincronizzare (o rifare l'accesso).
function driveBtnHtml() {
  if (!DRIVE.configured() || !DRIVE.everSynced()) return '';
  const st = DRIVE.status.state;
  const cls = st === 'needLogin' ? 'warn' : st === 'error' ? 'err' : st === 'syncing' ? 'spin' : '';
  const title = t('drive_st_' + st) + (DRIVE.lastSync() ? ` · ${t('drive_last')} ${new Date(DRIVE.lastSync()).toLocaleString(locale())}` : '');
  return `<button id="driveBtn" class="iconbtn drive ${cls}" data-act="drive-sync" title="${esc(title)}">${icon('cloud')}</button>`;
}
// Barra in basso quando l'accesso a Drive è scaduto: le modifiche fatte qui non arrivano agli altri dispositivi
// finché non tocchi «Ricollega» (Google chiede il tocco per rinnovare l'accesso).
function renderDriveBar() {
  let bar = document.getElementById('driveBar');
  const show = DRIVE.configured() && DRIVE.everSynced() && DRIVE.status.state === 'needLogin';
  if (!show) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'driveBar'; bar.className = 'drivebar'; document.body.appendChild(bar); }
  bar.innerHTML = `${icon('cloud')}<span>${t('drive_bar')}</span><button class="btn primary sm" data-act="drive-sync">${t('drive_relink')}</button>`;
}
function renderDriveState() {
  renderDriveBar();
  const b = $('#driveBtn');
  if (b) b.outerHTML = driveBtnHtml();
  const p = $('#driveStatus');
  if (p) p.innerHTML = driveStatusHtml();
}
function driveStatusHtml() {
  if (!DRIVE.configured()) return `<span class="muted">${t('drive_noClient')}</span>`;
  const st = DRIVE.status.state;
  return `<b>${t('drive_st_' + (DRIVE.everSynced() || st !== 'off' ? st : 'off'))}</b>${DRIVE.lastSync() ? ` · ${t('drive_last')} ${new Date(DRIVE.lastSync()).toLocaleString(locale())}` : ''}${st === 'error' && DRIVE.status.msg ? ` · <span class="muted">${esc(DRIVE.status.msg)}</span>` : ''}`;
}
// Modifiche sia qui che su Drive dall'ultima sincronizzazione: scegli quale copia tenere.
async function driveConflict({ localAt, remoteAt, first }) {
  const f = ts => ts ? new Date(ts).toLocaleString(locale()) : '—';
  const msg = (first ? t('drive_conflictFirst') : t('drive_conflict')).replace('{r}', f(remoteAt)).replace('{l}', f(localAt));
  return confirm(msg) ? 'remote' : 'local';
}
async function driveConnectAndSync() {
  try {
    if (!DRIVE.connected()) await DRIVE.login();
    await DRIVE.sync();
    if (DRIVE.status.state === 'ok') toast(t('drive_ok'));
  } catch (e) {
    toast(e.message === 'noclient' ? t('drive_noClient') : t('drive_loginFail'));
  }
  renderDriveState();
}

// logo: sprite di Nidoking (icons/nidoking-sprite.png, ingrandito senza sfocare in icons/logo.png)
function logoSvg() {
  return `<img class="logo-img" src="icons/logo.png" alt="NidoCollection">`;
}

function render() {
  const r = route();
  shell();
  const v = $('#view');
  // mentre scrivi nella ricerca: niente animazione di comparsa a ogni lettera
  if (S.noAnim) { v.classList.add('still'); S.noAnim = false; }
  ({ dashboard: viewDashboard, collection: viewCollection, search: viewSearch, sets: viewSets, master: viewMaster, sealed: viewSealed, wishlist: viewWishlist, settings: viewSettings }[r.name] || viewDashboard)(v, r.args);
  hydrateImages(v);
}

// immagini mancanti → prova la versione inglese
function hydrateImages(root) {
  root.querySelectorAll('img[data-fb]').forEach(async el => {
    const [lang, setId, localId] = el.dataset.fb.split('|');
    el.removeAttribute('data-fb');
    const base = await API.fallbackImage(lang, setId, localId);
    if (base) { el.src = img(base); el.closest('.ph')?.classList.remove('ph'); }
  });
}
// le pagine che si completano dopo (master set, espansioni, schede) aggiungono carte senza immagine più tardi:
// appena compaiono, cerca anche per loro l'immagine di ripiego (es. Classic Collection: Scrydex)
let fbPending = false;
new MutationObserver(() => {
  if (fbPending || !document.querySelector('img[data-fb]')) return;
  fbPending = true;
  requestAnimationFrame(() => { fbPending = false; hydrateImages(document); });
}).observe(document.body, { childList: true, subtree: true });
// immagine di una carta posseduta: foto caricata, immagine diretta (Topsun) o TCGdex
const hasImg = i => !!(i.photo || i.imgUrl || i.image || (i.db === 'cm' && CM.imageOf(i.cmId)));
function itemImg(i, q = 'low') {
  if (i.photo) return `<img loading="lazy" src="${i.photo}" alt="">`;
  if (i.imgUrl) return `<img loading="lazy" src="${esc(i.imgUrl)}" alt="">`;
  if (i.db === 'cm' && !i.image) { const c = CM.imageOf(i.cmId); if (c) return c.imgUrl ? `<img loading="lazy" src="${esc(c.imgUrl)}" alt="">` : cardImg(c.image, null, q); }
  // immagini Scrydex salvate (per alcune carte era solo il retro, es. Classic Collection): si ricalcolano, TCGplayer prima
  return cardImg(/^ext:s:/.test(i.image || '') ? null : i.image, !i.db || i.db === 'tcgdex' ? i.lang + '|' + i.setId + '|' + i.localId : null, q);
}
// ---------- carte gradate: anteprima "in busta" con l'etichetta in stile dell'ente ----------
const isGraded = i => !!(i && i.grade && i.grade.co);
const isBlackLabel = i => !!(i && i.grade && i.grade.co === 'BGS' && i.grade.black && parseFloat(String(i.grade.g).replace(',', '.')) >= 10);
function gradeDesc(co, g) {
  const v = parseFloat(String(g || '').replace(',', '.'));
  if (isNaN(v)) return '';
  if (v >= 10) return ['BGS', 'TAG', 'CGC'].includes(co) ? 'PRISTINE' : 'GEM MINT';
  if (v >= 9.5) return co === 'PSA' ? 'MINT+' : 'GEM MINT';
  const d = { 9: 'MINT', 8.5: 'NM-MT+', 8: 'NM-MT', 7.5: 'NM+', 7: 'NM', 6.5: 'EX-MT+', 6: 'EX-MT', 5.5: 'EX+', 5: 'EX', 4.5: 'VG-EX+', 4: 'VG-EX', 3.5: 'VG+', 3: 'VG', 2.5: 'GOOD+', 2: 'GOOD', 1.5: 'FAIR', 1: 'POOR' };
  return d[v] || '';
}
// Marchio dell'ente disegnato in stile (non è il file del logo ufficiale)
function slabLogo(co, tier) {
  switch (co) {
    case 'PSA': return `<span class="lg lg-psa">PSA</span>`;
    case 'BGS': return `<span class="lg lg-bgs"><i></i><span><b>BECKETT</b><small>GRADING</small></span></span>`;
    case 'CGC': return `<span class="lg lg-cgc"><b>CGC</b><small>CARDS</small></span>`;
    case 'SGC': return `<span class="lg lg-sgc"><b>SGC</b></span>`;
    case 'TAG': return `<span class="lg lg-tag"><b>TAG</b><small>GRADING</small></span>`;
    case 'AiGrading': return `<span class="lg lg-ai"><b>AI</b><small>GRADING</small></span>`;
    default: return `<span class="lg lg-txt"><b>${esc(co)}</b></span>`;
  }
}
// codice a barre finto, diverso per ogni certificato
function slabBarcode(cert) {
  let h = 7, stops = [], x = 0;
  for (const ch of String(cert)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  while (x < 100) {
    h = (h * 1103515245 + 12345) >>> 0;
    const w = 1 + (h >>> 8) % 3, gap = 1 + (h >>> 12) % 2;
    stops.push(`var(--lab-bar) ${x}% ${x + w * 0.9}%`, `transparent ${x + w * 0.9}% ${x + (w + gap) * 0.9}%`);
    x += (w + gap) * 0.9;
  }
  return `<i class="sl-bar" style="background:linear-gradient(90deg,${stops.join(',')})"></i>`;
}
function slabHtml(i, inner) {
  const co = i.grade.co, g = String(i.grade.g || '').replace(',', '.');
  const v = parseFloat(g);
  // BGS: argento fino a 9, oro da 9.5 (anche Pristine 10), nera solo per il Black Label (tutti i sottovoti 10)
  // CGC: etichetta oro per il Pristine 10
  const black = isBlackLabel(i);
  const tier = co === 'BGS' ? (black ? 'black' : v >= 9.5 ? 'gold' : 'silver') : co === 'CGC' && v >= 10 ? 'gold' : '';
  const year = i.releaseDate ? String(i.releaseDate).slice(0, 4) + ' ' : '';
  const lang = { it: 'ITALIAN', en: '', ja: 'JAPANESE', fr: 'FRENCH', de: 'GERMAN', es: 'SPANISH' }[i.lang] ?? String(i.lang || '').toUpperCase();
  const cert = i.grade.cert || '';
  return `<div class="slab slab-${co.toLowerCase().replace(/[^a-z]/g, '')} ${tier}">
    <div class="sl-label">
      <div class="sl-logo">${slabLogo(co, tier)}</div>
      <div class="sl-l"><span class="sl-set">${esc((year + 'POKÉMON ' + lang + ' ' + (i.setName || '')).replace(/\s+/g, ' '))}</span>
        <b class="sl-name">${esc(i.name)}</b><span class="sl-var">${esc(isPlain(i) ? '' : variantLabel(i))}</span></div>
      <div class="sl-r"><span class="sl-num">${esc(numLabel(i))}</span><span class="sl-desc">${esc(black ? 'BLACK LABEL' : gradeDesc(co, g))}</span><b class="sl-g">${esc(g || '–')}</b></div>
      <div class="sl-foot">${cert ? slabBarcode(cert) + `<span class="sl-cert">${esc(cert)}</span>` : ''}</div>
    </div>
    <div class="sl-win">${inner}</div>
  </div>`;
}

function cardImg(base, fb, q = 'low', cls = '') {
  // data-card: se l'immagine salvata non si carica, l'app cerca quella di ripiego (vedi gestore 'error')
  if (base) return `<img class="${cls}" loading="lazy" src="${img(base, q)}" alt="" ${fb ? `data-card="${esc(fb)}"` : ''}>`;
  return `<img class="${cls}" loading="lazy" alt="" ${fb ? `data-fb="${esc(fb)}"` : ''}>`;
}

// collezione vuota nell'estensione: i dati della versione aperta come file restano là finché non li importi
// pagina aperta come file → suggerisce l'estensione; versione web (GitHub Pages) → spiega il limite
const cmNoExtKey = () => location.protocol === 'file:' ? 'cm_noext' : 'cm_web';
const moveHintHtml = () => EBAY.isExt ? `<p class="note" style="margin:22px auto 10px;max-width:560px">${t('moveHint')}</p><a class="btn" href="#/settings">${t('importJson')}</a>` : '';

// ---------- PANORAMICA ----------
function viewDashboard(v) {
  const col = collection();
  const tt = totals(col);
  const st = sealedTotals();
  const cardsValue = tt.value;
  tt.value += st.value;
  if (st.cost) {
    const knownCards = tt.gain != null ? tt.gain + tt.cost : 0;
    tt.cost += st.cost;
    tt.gain = knownCards + st.costKnownValue - tt.cost;
    tt.gainPct = (knownCards + st.costKnownValue) / tt.cost - 1;
  }
  if (!col.length && !S.sealed.length) {
    v.innerHTML = `<div class="empty hero-empty">${logoSvg()}<h2>${t('emptyCollection')}</h2><p>${t('emptyCollectionHint')}</p><a class="btn primary" href="#/search">${icon('search')} ${t('goSearch')}</a>${moveHintHtml()}</div>`;
    return;
  }
  const hist = S.portfolio;
  const ago = days => { const d = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); const p = [...hist].reverse().find(x => x[0] <= d); return p ? p[1] : null; };
  const v7 = ago(7), v30 = ago(30);
  const top = [...col].sort((a, b) => (unitValue(b) || 0) - (unitValue(a) || 0)).slice(0, 12);
  const movers = col.filter(i => change7(i) != null && (unitValue(i) || 0) >= 0.5).sort((a, b) => Math.abs(change7(b)) - Math.abs(change7(a))).slice(0, 6);
  const bySet = {};
  col.forEach(i => { const k = i.setName + (i.lang !== 'en' ? ' · ' + LANG_BADGE[i.lang] : ''); bySet[k] = (bySet[k] || 0) + (itemValue(i) || 0); });
  const setRows = Object.entries(bySet).sort((a, b) => b[1] - a[1]);
  const setTop = setRows.slice(0, 7); const rest = setRows.slice(7).reduce((a, b) => a + b[1], 0);
  if (rest > 0) setTop.push(['…', rest]);
  const maxSet = Math.max(...setTop.map(x => x[1]), 0.01);
  const byLang = {};
  col.forEach(i => { byLang[i.lang] = (byLang[i.lang] || 0) + (i.qty || 1); });

  v.innerHTML = `
  <div class="dash">
    <div class="panel hero">
      <div class="hero-top">
        <div>
          <div class="label">${t('totalValue')}</div>
          <div class="big">${money(tt.value)}</div>
          <div class="deltas">
            ${v7 ? `<span>${pct(tt.value / v7 - 1)} <small>${t('last7')}</small></span>` : ''}
            ${v30 && v30 !== v7 ? `<span>${pct(tt.value / v30 - 1)} <small>${t('last30')}</small></span>` : ''}
          </div>
        </div>
        <div class="hero-stats">
          <div><div class="label">${t('costBasis')}</div><div class="mid">${tt.cost ? money(tt.cost) : '—'}</div></div>
          <div><div class="label">${t('gain')}</div><div class="mid ${tt.gain > 0 ? 'pos' : tt.gain < 0 ? 'neg' : ''}">${tt.gain != null ? money(tt.gain) + ' ' + pct(tt.gainPct) : '—'}</div></div>
          <div><div class="label">${t('cards')}</div><div class="mid">${tt.cards}</div></div>
          <div><div class="label">${t('unique')}</div><div class="mid">${tt.unique}</div></div>
          <div><div class="label">${t('cardsValue')}</div><div class="mid">${money(cardsValue)}</div></div>
          <div><div class="label">${t('nav_sealed')}</div><div class="mid">${st.n ? money(st.value) + ` <small class="muted">(${st.n})</small>` : '—'}</div></div>
          <div><div class="label">${t('nav_master')}</div><div class="mid">${S.masters.length || '—'}</div></div>
        </div>
      </div>
      <div class="chart-wrap"><div class="chart-head"><span class="label">${t('valueHistory')}</span></div><div id="pfChart" class="chart"></div></div>
    </div>

    ${col.length ? `<div class="panel span2">
      <div class="panel-head"><h3>${t('topCards')}</h3><a href="#/collection" class="link">${t('nav_collection')} →</a></div>
      <div class="strip">${top.map(i => `
        <button class="mini" data-act="open-item" data-uid="${i.uid}">
          <div class="mini-img ${hasImg(i) ? '' : 'ph'}">${itemImg(i)}</div>
          <div class="mini-name">${esc(i.name)}</div><div class="mini-price">${money(unitValue(i))}</div>
        </button>`).join('')}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>${t('movers')}</h3></div>
      ${movers.length ? `<div class="rows">${movers.map(i => `
        <button class="row" data-act="open-item" data-uid="${i.uid}">
          <div class="row-img">${itemImg(i)}</div>
          <div class="row-main"><div class="row-name">${esc(i.name)}</div><div class="row-sub">${esc([i.setName, numLabel(i)].filter(Boolean).join(' · '))}</div></div>
          <div class="row-end"><div>${money(unitValue(i))}</div>${pct(change7(i))}</div>
        </button>`).join('')}</div>` : `<p class="muted">—</p>`}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>${t('bySet')}</h3></div>
      <div class="bars">${setTop.map(([k, val]) => `
        <div class="bar-row" title="${esc(k)}: ${money(val)}"><div class="bar-label">${esc(k)}</div>
        <div class="bar-track"><div class="bar" style="width:${Math.max(2, val / maxSet * 100)}%"></div></div><div class="bar-val">${money(val, { compact: true })}</div></div>`).join('')}</div>
      <div class="langs">${Object.entries(byLang).map(([l, n]) => `<span class="chip">${LANG_BADGE[l] || l} · ${n}</span>`).join('')}</div>
    </div>` : ''}
  </div>`;

  // serie storica: se ci sono pochi punti, stima dalle medie Cardmarket (30 gg, 7 gg, 1 g, oggi)
  let pts = hist.map(([d, val]) => ({ d, v: val }));
  let estimated = false;
  if (pts.length < 4) {
    estimated = true;
    const sum = f => st.value + col.reduce((a, i) => a + ((f(i) ?? unitValue(i) ?? 0) * (i.qty || 1)), 0);
    const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    pts = [
      { d: day(30), v: sum(i => i.cm && i.cm.avg30) },
      { d: day(7), v: sum(i => i.cm && i.cm.avg7) },
      { d: day(1), v: sum(i => i.cm && i.cm.avg1) },
      { d: today(), v: tt.value }
    ];
  }
  drawChart($('#pfChart'), pts, { estimated, height: 190 });
}

// grafico ad area con mirino e tooltip
function drawChart(el, pts, opts = {}) {
  if (!el) return;
  const W = Math.max(280, el.clientWidth || 600), H = opts.height || 180;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  if (!pts.length) { el.innerHTML = ''; return; }
  if (pts.length === 1) pts = [{ ...pts[0], d: pts[0].d }, pts[0]];
  const xs = pts.map(p => new Date(p.d).getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const vals = pts.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += hi * 0.05 || 1; lo -= lo * 0.05 || 1; }
  const span = hi - lo; lo -= span * 0.12; hi += span * 0.12;
  const X = x => pad.l + ((x - x0) / ((x1 - x0) || 1)) * (W - pad.l - pad.r);
  const Y = y => pad.t + (1 - (y - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const P = pts.map((p, i) => [X(xs[i]), Y(p.v)]);
  const line = P.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${P[P.length - 1][0].toFixed(1)} ${H - pad.b} L${P[0][0].toFixed(1)} ${H - pad.b} Z`;
  const up = vals[vals.length - 1] >= vals[0];
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const ticks = [0, 0.5, 1].map(f => x0 + (x1 - x0) * f);
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="${up ? 'up' : 'down'}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map(f => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + f * (H - pad.t - pad.b)}" y2="${pad.t + f * (H - pad.t - pad.b)}"/>`).join('')}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" class="line ${opts.estimated ? 'dash' : ''}" fill="none"/>
    ${ticks.map((x, i) => `<text class="tick" x="${X(x)}" y="${H - 5}" text-anchor="${['start', 'middle', 'end'][i]}">${fmtDate(new Date(x))}</text>`).join('')}
    <line class="xh" y1="${pad.t}" y2="${H - pad.b}" x1="-10" x2="-10"/><circle class="dot" r="5" cx="-10" cy="-10"/>
  </svg><div class="tip"></div>${opts.estimated ? `<div class="est">≈ Cardmarket 30 / 7 / 1 gg</div>` : ''}`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xh'), dot = el.querySelector('.dot');
  svg.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let bi = 0; P.forEach((p, i) => { if (Math.abs(p[0] - mx) < Math.abs(P[bi][0] - mx)) bi = i; });
    const [px, py] = P[bi];
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
    tip.innerHTML = `<b>${money(pts[bi].v)}</b><span>${fmtDate(pts[bi].d)}</span>`;
    tip.style.opacity = 1;
    tip.style.left = Math.min(W - 120, Math.max(0, px - 60)) + 'px';
    tip.style.top = Math.max(0, py - 52) + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.style.opacity = 0; xh.setAttribute('x1', -10); xh.setAttribute('x2', -10); dot.setAttribute('cx', -10); });
}

// ---------- COLLEZIONE / DESIDERI ----------
function itemTile(i, wish) {
  const u = unitValue(i);
  const below = wish && i.targetPrice != null && u != null && u <= i.targetPrice;
  return `<button class="tile ${below ? 'glow' : ''}" data-act="open-item" data-uid="${i.uid}">
    <div class="tile-img ${isGraded(i) ? 'slabbed' : hasImg(i) ? '' : 'ph'}">${isGraded(i) ? slabHtml(i, `<div class="sl-card ${hasImg(i) ? '' : 'ph'}">${itemImg(i)}</div>`) : itemImg(i)}
      <div class="badges">${(i.qty || 1) > 1 ? `<span class="b qty">×${i.qty}</span>` : ''}${i.dup ? `<span class="b" title="${esc(t('dup_hint'))}">${t('dup_badge')}</span>` : ''}<span class="b">${LANG_BADGE[i.lang] || i.lang}</span>${i.grade && i.grade.co ? `<span class="b gold">${esc(i.grade.co)} ${esc(i.grade.g || '')}${isBlackLabel(i) ? ' Black Label' : ''}</span>` : ''}${!isPlain(i) ? `<span class="b v">${esc(variantLabel(i))}</span>` : ''}</div>
    </div>
    <div class="tile-body">
      <div class="tile-name">${esc(i.name)}</div>
      <div class="tile-sub">${esc([i.setName, numLabel(i)].filter(Boolean).join(' · '))}</div>
      <div class="tile-price">${money(u)} ${wish ? (i.targetPrice != null ? `<small class="muted">/ ${money(i.targetPrice)}</small>` : '') : pct(change7(i))}</div>
    </div></button>`;
}

function sortItems(list) {
  const s = S.settings.sort;
  const by = {
    value: (a, b) => (itemValue(b) || 0) - (itemValue(a) || 0),
    name: (a, b) => a.name.localeCompare(b.name, locale()),
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    gain: (a, b) => ((b.buyPrice != null ? (unitValue(b) || 0) - b.buyPrice : -1e9) * (b.qty || 1)) - ((a.buyPrice != null ? (unitValue(a) || 0) - a.buyPrice : -1e9) * (a.qty || 1)),
    change: (a, b) => (change7(b) ?? -9) - (change7(a) ?? -9),
    set: (a, b) => a.setName.localeCompare(b.setName) || String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true })
  }[s] || (() => 0);
  return [...list].sort(by);
}

function viewCollection(v, args, wish = false) {
  const all = wish ? wishlist() : collection();
  const f = S.colFilter;
  const setsOpts = [...new Map(all.map(i => [i.lang + '|' + i.setId, i])).values()].sort((a, b) => a.setName.localeCompare(b.setName));
  const langs = [...new Set(all.map(i => i.lang))];
  let list = all.filter(i =>
    (!f.q || (i.name + ' ' + i.setName + ' ' + i.localId + ' ' + (i.notes || '')).toLowerCase().includes(f.q.toLowerCase())) &&
    (!f.set || i.lang + '|' + i.setId === f.set) && (!f.lang || i.lang === f.lang));
  list = sortItems(list);
  const tt = totals(list);
  // Master set completi: una sola scheda con il valore complessivo (le gradate restano a parte).
  // Scegliendo il set nel filtro si vedono di nuovo le singole carte.
  const groups = [];
  if (!wish && !f.set && !f.q) {
    // (solo con il conteggio fatto dopo l'unione dei set inclusi: stats.ver 2)
    S.masters.filter(m => m.stats && m.stats.ver === 2 && m.stats.total > 0 && m.stats.owned >= m.stats.total).forEach(m => {
      const k = m.lang + '|' + m.setId;
      const keys = new Set(masterSetKeys(m)); // compresi i set inclusi (Classic Collection nel 30°)
      // (i doppioni già messi da parte da un altro master set restano fuori)
      const inSet = list.filter(i => keys.has(i.lang + '|' + i.setId) && !(i.grade && i.grade.co) && !i.dup);
      if (!inSet.length) return;
      // Nel master set va UNA sola copia per carta/versione: i doppioni restano in collezione come carte singole.
      // A parità si tiene nel master la copia in condizione migliore.
      const COND = ['GM', 'MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
      const rank = i => { const r = COND.indexOf(i.condition || 'NM'); return r < 0 ? 9 : r; };
      const taken = new Map(), rest = [];
      [...inSet].sort((a, b) => rank(a) - rank(b)).forEach(i => {
        const sk = [i.lang, i.cardId, i.variant || 'normal', i.finish || ''].join('|');
        if (taken.has(sk)) { rest.push({ ...i, dup: true }); return; }
        taken.set(sk, i);
        // stessa scheda con più copie: una nel master, le altre fuori (stessa carta, quantità ridotta)
        if ((i.qty || 1) > 1) rest.push({ ...i, qty: (i.qty || 1) - 1, dup: true });
      });
      const one = [...taken.values()];
      const ids = new Set(inSet.map(i => i.uid));
      list = sortItems([...list.filter(i => !ids.has(i.uid)), ...rest]);
      // valore: stima eBay del master set completo (annunci in vendita); senza stima, somma delle carte
      groups.push({ m, k, items: one, value: m.stats.est != null ? m.stats.est : one.reduce((a, i) => a + (unitValue(i) || 0), 0), est: m.stats.est != null, cards: one.length,
        cost: one.some(i => i.buyPrice != null) ? one.reduce((a, i) => a + (i.buyPrice || 0), 0) : null });
    });
    groups.sort((a, b) => b.value - a.value);
  }
  const groupTile = g => `<a class="tile mtile" href="#/master/${g.m.lang}/${encodeURIComponent(g.m.setId)}" title="${esc(t('masterGroup_hint'))}">
    <div class="tile-img mset">${masterLogoHtml(g.m) || `<b>${esc(g.m.setName || g.m.setId)}</b>`}
      <div class="badges"><span class="b">${LANG_BADGE[g.m.lang] || g.m.lang}</span><span class="b gold">🏆 Master set</span></div></div>
    <div class="tile-body"><div class="tile-name">${esc(g.m.setName || g.m.setId)}</div>
      <div class="tile-sub">${t('masterGroup_sub').replace('{n}', g.cards)}</div>
      <div class="tile-price">${money(g.value)}</div></div></a>`;
  const groupRow = g => `<tr data-act="open-mgroup" data-k="${esc(g.k)}">
    <td class="thumb">${masterLogoHtml(g.m) || '🏆'}</td>
    <td><b>${esc(g.m.setName || g.m.setId)}</b> <span class="chip tiny gold">🏆 Master set</span></td>
    <td>${t('masterGroup_sub').replace('{n}', g.cards)}</td><td>${LANG_BADGE[g.m.lang]}</td><td>NM</td>
    <td class="r">${g.cards}</td><td class="r">—</td><td class="r">—</td><td class="r"><b>${money(g.value)}</b></td>
    <td class="r ${g.cost != null ? (g.value - g.cost > 0 ? 'pos' : 'neg') : ''}">${g.cost != null ? money(g.value - g.cost) : '—'}</td></tr>`;
  if (!all.length) {
    v.innerHTML = `<div class="empty hero-empty">${icon(wish ? 'wishlist' : 'collection')}<h2>${wish ? t('wishEmpty') : t('emptyCollection')}</h2><p>${t('emptyCollectionHint')}</p><a class="btn primary" href="#/search">${icon('search')} ${t('goSearch')}</a>${moveHintHtml()}</div>`;
    return;
  }
  v.innerHTML = `
  <div class="page-head">
    <div><h1>${wish ? t('nav_wishlist') : t('nav_collection')}</h1><div class="sub">${tt.cards} ${t('cards').toLowerCase()} · <b>${money(tt.value)}</b>${wish ? '' : ` · <span class="muted">${scanWhen()}</span>`}</div></div>
    ${wish ? '' : scanBtnHtml('mob-only')}
  </div>
  <div class="toolbar coltools">
    ${isMobile() ? '' : `<input class="inp" data-cf="q" placeholder="${esc(t('filter'))}" value="${esc(f.q)}">`}
    <select class="inp" data-cf="set"><option value="">${t('allSets')}</option>${setsOpts.map(i => `<option value="${esc(i.lang + '|' + i.setId)}" ${f.set === i.lang + '|' + i.setId ? 'selected' : ''}>${esc(i.setName)} (${LANG_BADGE[i.lang]})</option>`).join('')}</select>
    <select class="inp" data-cf="lang"><option value="">${t('allLangs')}</option>${langs.map(l => `<option value="${l}" ${f.lang === l ? 'selected' : ''}>${t('lang_' + l)}</option>`).join('')}</select>
    <select class="inp" data-set="sort" aria-label="${t('sort')}">${['value', 'change', 'gain', 'added', 'name', 'set'].map(s => `<option value="${s}" ${S.settings.sort === s ? 'selected' : ''}>${t('sort') }: ${t('sort_' + s)}</option>`).join('')}</select>
    <div class="seg small">
      <button data-act="view" data-v="grid" class="${S.settings.view === 'grid' ? 'on' : ''}" title="${t('grid')}">${icon('grid')}</button>
      <button data-act="view" data-v="list" class="${S.settings.view === 'list' ? 'on' : ''}" title="${t('list')}">${icon('list')}</button>
    </div>
  </div>
  ${S.settings.view === 'list' ? `
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th></th><th>${t('sort_name')}</th><th>${t('set')}</th><th>${t('language')}</th><th>${t('condition')}</th><th class="r">${t('qty')}</th><th class="r">${t('price')}</th><th class="r">7/30</th><th class="r">${wish ? t('targetPrice') : t('value')}</th>${wish ? '' : `<th class="r">${t('gain')}</th>`}</tr></thead>
    <tbody>${groups.map(groupRow).join('')}${list.map(i => { const u = unitValue(i); const g = i.buyPrice != null && u != null ? (u - i.buyPrice) * (i.qty || 1) : null; return `
      <tr data-act="open-item" data-uid="${i.uid}">
        <td class="thumb">${itemImg(i)}</td>
        <td><b>${esc(i.name)}</b>${!isPlain(i) ? ` <span class="chip tiny">${esc(variantLabel(i))}</span>` : ''}${i.grade && i.grade.co ? ` <span class="chip tiny gold">${esc(i.grade.co + ' ' + (i.grade.g || ''))}</span>` : ''}</td>
        <td>${esc(i.setName)} <span class="muted">${numLabel(i)}</span></td><td>${LANG_BADGE[i.lang]}</td><td>${esc(i.condition || '')}</td>
        <td class="r">${i.qty || 1}</td><td class="r">${money(u)}</td><td class="r">${pct(change7(i))}</td>
        <td class="r"><b>${wish ? money(i.targetPrice) : money(itemValue(i))}</b></td>${wish ? '' : `<td class="r ${g > 0 ? 'pos' : g < 0 ? 'neg' : ''}">${g != null ? money(g) : '—'}</td>`}
      </tr>`; }).join('')}</tbody></table></div>` :
    `<div class="grid">${groups.map(groupTile).join('')}${list.map(i => itemTile(i, wish)).join('')}</div>`}
  ${!list.length && !groups.length ? `<p class="muted center">${t('noResults')}</p>` : ''}`;
  if (groups.length) fillMasterLogos();
}
const viewWishlist = (v, a) => viewCollection(v, a, true);

// ---------- RICERCA ----------
function ownedCount(lang, cardId) {
  return collection().filter(i => i.lang === lang && i.cardId === cardId).reduce((a, i) => a + (i.qty || 1), 0);
}
// versione scelta dalla ricerca «Reverse holo e timbrate»: attributi da passare a scheda e aggiunta rapida
const slotAttrs = slot => slot ? ` data-variant="${esc(slot.variant)}" data-finish="${esc(slot.finish || '')}" data-fl="${esc(slot.finishLabel || '')}"` : '';
const slotFromEl = el => el && el.dataset.variant ? { variant: el.dataset.variant, finish: el.dataset.finish || null, finishLabel: el.dataset.fl || null } : null;
const revLabel = slot => slot.finish ? (/^stamp/.test(slot.finish) ? t('stamp_label') + ' · ' : 'Reverse · ') + finishLabel(slot.finish, slot.finishLabel) : t('variant_reverse');
function resultTile(c, slot) {
  const own = slot ? collection().filter(i => i.lang === c.lang && i.cardId === c.id && i.variant === slot.variant && (i.finish || null) === (slot.finish || null)).reduce((a, i) => a + (i.qty || 1), 0) : ownedCount(c.lang, c.id);
  return `<div class="tile res ${own ? 'owned' : ''}" data-act="open-card" data-lang="${c.lang}" data-id="${esc(c.id)}"${slotAttrs(slot)} tabindex="0" role="button">
    <div class="tile-img ${c.image ? '' : 'ph'} ${slot ? 'revtile' : ''}">${cardImg(c.image, c.lang + '|' + c.setId + '|' + c.localId)}
      <div class="badges">${slot ? `<span class="b v">${esc(revLabel(slot))}</span>` : ''}${own ? `<span class="b own">✓ ${own}</span>` : ''}</div>
      <button class="addbtn" data-act="quick-add" data-lang="${c.lang}" data-id="${esc(c.id)}"${slotAttrs(slot)} title="${t('quickAdd')}">${icon('plus')}</button>
    </div>
    <div class="tile-body"><div class="tile-name">${esc(c.name)}</div><div class="tile-sub">${esc(c.setName)} · ${numLabel(c)}</div></div>
  </div>`;
}

function viewSearch(v) {
  const s = S.search;
  const lang = s.lang || S.settings.cardLang;
  v.innerHTML = `
  <div class="page-head"><div><h1>${t('nav_search')}</h1></div></div>
  <form class="bigsearch" data-form="search">
    ${icon('search')}<input name="q" autocomplete="off" placeholder="${esc(t('searchPlaceholder'))}" value="${esc(s.q)}" autofocus>
    <select name="lang" aria-label="${t('searchIn')}">${CARD_LANGS.map(l => `<option value="${l}" ${lang === l ? 'selected' : ''}>${LANG_BADGE[l]} · ${t('lang_' + l)}</option>`).join('')}</select>
    <button class="btn primary">${t('search')}</button>
  </form>
  <div class="seg searchver" role="group" aria-label="${t('variant')}">${[['all', 'rev_all'], ['rev', 'rev_only']].map(([k, l]) => `<button data-act="search-ver" data-v="${k}" class="${(S.searchVer || 'all') === k ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
  <div class="search-tools"><span class="muted small">${t('search_sources')}<br>${t('search_tip')}</span>
    <button class="btn ghost" data-act="custom-card">${icon('plus')} ${t('custom_add')}</button></div>
  <div id="results">${s.loading ? `<div class="loading"><span class="spinner"></span>${t('searching')}</div>` :
    s.error ? `<p class="err">${esc(s.error)}</p>` : searchResultsHtml(s)}
  </div>`;
}

function searchResultsHtml(s) {
  if (!s.q) return '';
  const blocks = [];
  const info = [];
  const cmFirst = s.promo && s.cm && s.cm.length; // promo: il catalogo Cardmarket è la fonte più completa, va in cima
  if (s.fixed) info.push(`${t('search_fixed')} <b>${esc(s.fixed)}</b>?`);
  if (s.setLabel) info.push(`${t('search_inSet')}: <b>${esc(s.setLabel)}</b>`);
  if (s.numIgnored) info.push(esc(t('search_numIgnored').replace('{n}', s.num)));
  if (info.length) blocks.push(`<p class="note">${info.join(' · ')}</p>`);
  if (s.ver === 'rev' && s.results.length) {
    // solo le versioni reverse holo e timbrate (una scheda per versione)
    const tiles = s.results.slice(0, s.shown).flatMap(c => (s.rev[c.id] || []).map(slot => resultTile(c, slot)));
    if (s.revLoading) blocks.push(`<div class="loading small"><span class="spinner"></span>${t('rev_loading').replace('{n}', s.revDone).replace('{t}', Math.min(s.results.length, s.shown))}</div>`);
    blocks.push(`<div class="sub">${tiles.length} ${t('rev_found')} · TCGdex</div>${tiles.length ? `<div class="grid">${tiles.join('')}</div>` : !s.revLoading ? `<p class="muted">${t('rev_none')}</p>` : ''}
      ${s.results.length > s.shown && !s.revLoading ? `<div class="center"><button class="btn" data-act="more">${t('loadMore')}</button></div>` : ''}`);
  } else if (s.results.length) blocks.push(`<div class="sub">${s.results.length} ${t('results')} · TCGdex</div><div class="grid">${s.results.slice(0, s.shown).map(c => resultTile(c)).join('')}</div>
      ${s.results.length > s.shown ? `<div class="center"><button class="btn" data-act="more">${t('loadMore')}</button></div>` : ''}`);
  if (s.ver !== 'rev') (s.others || []).forEach(o => blocks.push(`<h3 class="rhead">${t('search_otherLang')} (${LANG_BADGE[o.lang]})</h3><div class="grid">${o.list.slice(0, 60).map(c => resultTile(c)).join('')}</div>`));
  if (s.topsun && s.topsun.length) blocks.push(`<h3 class="rhead">Topsun (1997)</h3><div class="grid">${s.topsun.slice(0, 60).map(c => `
    <div class="tile res" data-act="open-cat" data-src="topsun" data-id="${esc(c.id)}" tabindex="0" role="button">
      <div class="tile-img"><img loading="lazy" src="${esc(c.imgUrl)}" alt="">
        <button class="addbtn" data-act="quick-cat" data-src="topsun" data-id="${esc(c.id)}" title="${t('quickAdd')}">${icon('plus')}</button></div>
      <div class="tile-body"><div class="tile-name">${esc(c.name)}</div><div class="tile-sub">Topsun · #${esc(c.localId)}</div></div>
    </div>`).join('')}</div>`);
  if (s.cm && s.cm.length) blocks.splice(cmFirst ? (info.length ? 1 : 0) : blocks.length, 0, `<h3 class="rhead">${t('cm_section')} <span class="muted small">(${s.cm.length >= 120 ? '120+' : s.cm.length})</span></h3>
    <div class="cmlist">${s.cm.map(c => { const p = CM.priceOf(c.idProduct, false); const im = CM.imageOf(c.idProduct); return `
      <div class="cmrow" data-act="open-cat" data-src="cm" data-id="${c.idProduct}" role="button" tabindex="0">
        <div class="cm-thumb ${im ? '' : 'none'}">${im ? (im.imgUrl ? `<img loading="lazy" src="${esc(im.imgUrl)}" alt="">` : `<img loading="lazy" src="${esc(img(im.image))}" alt="">`) : icon('search', 'sm')}</div>
        <div class="cm-name"><b>${esc(c.name)}</b><span class="muted small">${esc(c.expansion || t('cm_exp') + ' #' + c.idExpansion)}</span></div>
        <div class="cm-price">${p ? money(p.trend || p.avg30) : '—'}</div>
        <button class="iconbtn" data-act="quick-cat" data-src="cm" data-id="${c.idProduct}" title="${t('quickAdd')}">${icon('plus')}</button>
      </div>`; }).join('')}</div>`);
  else if (s.cmState === 'noext') blocks.push(`<p class="note warn">${t(cmNoExtKey())}</p>`);
  else if (s.cmState === 'loading') blocks.push(`<div class="loading small"><span class="spinner"></span>${t('cm_loading')}</div>`);
  if (!blocks.length) blocks.push(`<p class="muted center">${t('noResults')}</p><div class="center"><button class="btn" data-act="custom-card">${icon('plus')} ${t('custom_add')}</button></div>`);
  return blocks.join('');
}

const REV_WORDS = /(^|\s)(reverse\s*holo|reverse|rev|rh|timbrat[aei]|stamp(ed)?|stampata)(?=\s|$)/gi;
// carica i dettagli delle carte mostrate per sapere quali hanno la versione reverse o timbrata
async function loadRevSlots(s) {
  const list = s.results.slice(0, s.shown).filter(c => !(c.id in s.rev));
  if (!list.length) return;
  s.revLoading = true; s.revDone = s.results.slice(0, s.shown).length - list.length;
  let i = 0, last = 0;
  const step = () => { if (route().name === 'search' && S.search === s && Date.now() - last > 400) { last = Date.now(); render(); } };
  async function worker() {
    while (i < list.length) {
      const c = list[i++];
      try { const card = await API.getCard(c.lang || s.lang, c.id); s.rev[c.id] = card ? API.revSlots(card) : []; } catch { s.rev[c.id] = []; }
      s.revDone++; step();
    }
  }
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  s.revLoading = false;
  if (route().name === 'search' && S.search === s) render();
}
async function doSearch(q, lang) {
  let ver = S.searchVer || 'all';
  const q2 = q.replace(REV_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (q2 !== q && q2) { ver = 'rev'; S.searchVer = 'rev'; }
  S.search = { q, lang, ver, rev: {}, revDone: 0, results: [], others: [], topsun: [], cm: [], shown: 60, loading: true, error: null, cmState: null };
  q = q2 || q;
  if (route().name !== 'search') go('search'); else render();
  const s = S.search;
  // il catalogo Cardmarket serve anche a riconoscere i nomi delle espansioni: se è già salvato lo carica subito
  if (CM.canLoad && !CM.ready) await Promise.race([CM.load(), new Promise(r => setTimeout(r, 1500))]);
  let r = null;
  try {
    r = await SMART.search(lang, q);
    Object.assign(s, { results: r.main, others: r.others, fixed: r.fixed, setLabel: r.setLabel, num: r.num, numIgnored: r.numIgnored, promo: r.promo });
  } catch (e) { console.warn(e); s.error = t('offline'); }
  const cmQuery = r ? r.cmWords.join(' ') : q;
  s.topsun = TOPSUN.search(cmQuery);
  s.loading = false;
  if (ver === 'rev') loadRevSlots(s);
  if (CM.canLoad) {
    s.cmState = CM.ready ? null : 'loading';
    if (route().name === 'search' && S.search === s) render();
    if (await CM.load()) {
      let words = r ? r.cmWords : [], exp = r ? r.cmExp : [];
      // catalogo appena scaricato: ora può riconoscere anche le espansioni che conosce solo Cardmarket
      if (r && !exp.length) {
        try { const P = await SMART.parse(q, lang); if (P.cmExp.length) { exp = P.cmExp; const p = P.pokemon; words = p ? [...P.nameWords.slice(0, p.start), p.en, ...P.nameWords.slice(p.start + p.len)] : P.nameWords; if (!s.setLabel) s.setLabel = P.setLabel; } } catch { /* niente */ }
      }
      s.cm = r && (words.length || exp.length) ? CM.searchIn(words, exp, 400) : CM.search(q);
      // "promo"/"UNP"/"CoroCoro": prima le espansioni promozionali
      if (r && r.promo) { const pr = s.cm.filter(c => CM.isPromoExp(c.idExpansion)); if (pr.length) s.cm = pr; }
      s.cm = s.cm.slice(0, 120);
    }
    s.cmState = null;
  } else s.cmState = 'noext';
  if (route().name === 'search' && S.search === s) render();
}

// ---------- carte fuori da TCGdex: catalogo Cardmarket, Topsun, inserimento manuale ----------
const CUSTOM_SETS = ['Carddass – Part 1 (1996)', 'Carddass – Part 2 (1996)', 'Carddass – Part 3 & 4 (1997)', 'Carddass – Anime Series (1998–1999)',
  'Carddass – Anime Gold & Silver (2000)', 'Carddass – Pocket Monsters (altro)', 'Topsun (1997)', 'Topsun – Top Battle / VS', 'Meiji', 'Bandai – altro', 'Altro'];
const EXTRA_SLOTS = {
  cm: [{ variant: 'normal' }, { variant: 'reverse' }, { variant: 'holo' }, { variant: 'firstEdition' }],
  topsun: [{ variant: 'normal', finish: 'blueback', finishLabel: 'Retro blu' }, { variant: 'normal', finish: 'greenback', finishLabel: 'Retro verde' },
    { variant: 'holo', finish: 'prism', finishLabel: 'Prism' }, { variant: 'normal', finish: 'nonumber', finishLabel: 'Senza numero' }],
  custom: [{ variant: 'normal' }, { variant: 'holo' }, { variant: 'normal', finish: 'prism', finishLabel: 'Prism' }, { variant: 'normal', finish: 'sticker', finishLabel: 'Sticker' }]
};
function baseDraft() {
  return { uid: null, list: 'collection', rarity: '', image: null, imgUrl: null, photo: '', variant: 'normal', finish: null, condition: 'NM', grade: { co: '', g: '' }, qty: 1,
    buyPrice: null, buyDate: today(), notes: '', targetPrice: null, source: 'auto', manualPrice: null, history: [], addedAt: Date.now(), official: null };
}
function catalogDraft(src, id) {
  const d = baseDraft();
  if (src === 'cm') {
    const hit = S.search.cm.find(x => String(x.idProduct) === String(id));
    const name = hit ? hit.name : 'Cardmarket ' + id;
    Object.assign(d, { db: 'cm', cmId: +id, cardId: 'cm-' + id, lang: S.search.lang || S.settings.cardLang, name,
      setId: 'cm-exp-' + (hit ? hit.idExpansion : ''), setName: (hit && hit.expansion) || 'Cardmarket', localId: '', cm: CM.priceOf(+id, false), pricesAt: Date.now(),
      ...(CM.imageOf(id) || {}) });
  } else if (src === 'topsun') {
    const c = TOPSUN.list().find(x => x.id === id);
    Object.assign(d, { db: 'topsun', cardId: c.id, lang: 'ja', name: c.name, setId: 'topsun', setName: 'Topsun (1997)', localId: c.localId, imgUrl: c.imgUrl,
      variant: c.prism ? 'holo' : 'normal', finish: c.prism ? 'prism' : 'blueback', finishLabel: c.prism ? 'Prism' : 'Retro blu', source: 'ebay' });
  } else {
    Object.assign(d, { db: 'custom', cardId: 'custom-' + uid(), lang: 'ja', name: '', setId: 'custom', setName: CUSTOM_SETS[0], localId: '', source: 'ebay' });
  }
  return d;
}
function openCatalog(src, id) {
  M = { kind: 'card', draft: catalogDraft(src, id), card: null, isNew: true };
  document.body.classList.add('noscroll');
  renderModal();
}
function openStored(it) {
  const d = JSON.parse(JSON.stringify(it));
  if (d.db === 'cm' && CM.ready) { const c = CM.priceOf(d.cmId, d.variant === 'reverse'); if (c) d.cm = c; }
  if (d.db === 'cm' && !d.photo && !d.image && !d.imgUrl) Object.assign(d, CM.imageOf(d.cmId) || {});
  M = { kind: 'card', draft: d, card: null, isNew: false };
  document.body.classList.add('noscroll');
  renderModal();
}

// ---------- ESPANSIONI ----------
async function viewSets(v, args) {
  if (args[0] && args[1]) return viewSet(v, args[0], args[1]);
  const lang = S.sets.lang || S.settings.cardLang;
  v.innerHTML = `<div class="page-head"><div><h1>${t('nav_sets')}</h1></div>
    <div class="toolbar"><input class="inp" data-sf placeholder="${esc(t('setSearch'))}" value="${esc(S.sets.filter)}">
    <select class="inp" data-act-change="sets-lang">${CARD_LANGS.map(l => `<option value="${l}" ${lang === l ? 'selected' : ''}>${LANG_BADGE[l]} · ${t('lang_' + l)}</option>`).join('')}</select></div></div>
    <div id="setGrid"><div class="loading"><span class="spinner"></span></div></div>`;
  try {
    const list = await API.getSets(lang);
    S.sets.list = list; S.sets.lang = lang;
    renderSetGrid();
  } catch { $('#setGrid').innerHTML = `<p class="err">${t('offline')}</p>`; }
}
function renderSetGrid() {
  const g = $('#setGrid'); if (!g) return;
  const lang = S.sets.lang;
  const f = S.sets.filter.toLowerCase();
  const own = {};
  collection().filter(i => i.lang === lang).forEach(i => { (own[i.setId] = own[i.setId] || new Set()).add(i.cardId); });
  // nei master set non si sceglie un set incluso in un altro (Classic Collection → 30° anniversario)
  const included = route().name === 'master' ? new Set(Object.values(MASTER_EXTRA).flat()) : new Set();
  const list = [...S.sets.list].reverse().filter(s => !included.has(s.id) && (!f || s.name.toLowerCase().includes(f) || s.id.toLowerCase().includes(f)));
  g.innerHTML = `<div class="setgrid">${list.map(s => {
    const n = own[s.id] ? own[s.id].size : 0; const tot = s.cardCount ? s.cardCount.official || s.cardCount.total : 0;
    return `<a class="setcard ${n ? 'has' : ''}" href="#/${route().name === 'master' ? 'master' : 'sets'}/${lang}/${encodeURIComponent(s.id)}">
      <div class="setlogo">${s.logo ? `<img loading="lazy" src="${s.logo}.webp" alt="">` : `<span>${esc(s.name)}</span>`}</div>
      <div class="setname">${s.symbol ? `<img class="sym" src="${s.symbol}.webp" alt="">` : ''}${esc(s.name)}</div>
      <div class="setmeta"><span>${tot} ${t('cardsIn')}</span>${n ? `<span class="own">${n}/${tot}</span>` : ''}</div>
      ${n ? `<div class="prog"><i style="width:${Math.min(100, n / (tot || 1) * 100)}%"></i></div>` : ''}
    </a>`; }).join('')}</div>`;
}

async function viewSet(v, lang, id) {
  v.innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
  let s;
  try { s = await API.getSet(lang, id); } catch { v.innerHTML = `<p class="err">${t('offline')}</p>`; return; }
  if (!s) { v.innerHTML = `<p class="muted">${t('noResults')}</p>`; return; }
  const official = s.cardCount ? s.cardCount.official : null;
  const cards = (s.cards || []).map(c => ({ ...c, lang, setId: s.id, setName: s.name, official }));
  const ownedIds = new Set(collection().filter(i => i.lang === lang && i.setId === s.id).map(i => i.cardId));
  const nOwn = cards.filter(c => ownedIds.has(c.id)).length;
  const missingOnly = S.setView === 'missing';
  const value = collection().filter(i => i.lang === lang && i.setId === s.id).reduce((a, i) => a + (itemValue(i) || 0), 0);
  v.innerHTML = `
  <a class="back" href="#/sets">← ${t('nav_sets')}</a>
  <div class="set-hero">
    ${s.logo ? `<img class="set-hero-logo" src="${s.logo}.webp" alt="">` : ''}
    <div class="set-hero-info"><h1>${esc(s.name)}</h1>
      <div class="sub">${esc(s.serie ? s.serie.name : '')}${s.releaseDate ? ' · ' + fmtDate(s.releaseDate) : ''} · ${cards.length} ${t('cardsIn')}${value ? ' · <b>' + money(value) + '</b>' : ''}</div>
      <div class="prog big"><i style="width:${cards.length ? nOwn / cards.length * 100 : 0}%"></i></div>
      <div class="sub">${nOwn} ${t('of')} ${cards.length} · ${cards.length ? Math.round(nOwn / cards.length * 100) : 0}% ${t('set_progress')}</div>
    </div>
    <a class="btn" href="#/master/${lang}/${encodeURIComponent(s.id)}">${icon('master')} ${t('nav_master')}</a>
    <div class="seg"><button data-act="setview" data-v="all" class="${!missingOnly ? 'on' : ''}">${t('showAll')}</button><button data-act="setview" data-v="missing" class="${missingOnly ? 'on' : ''}">${t('showMissing')}</button></div>
  </div>
  <div class="grid">${cards.filter(c => !missingOnly || !ownedIds.has(c.id)).map(c => resultTile(c)).join('')}</div>`;
  v.querySelectorAll('.tile.res:not(.owned)').forEach(el => el.classList.add('dim'));
}

// ---------- MASTER SET ----------
// Un master set = ogni carta dell'espansione (fuoriserie comprese) in ogni sua versione:
// normale, reverse, holo e reverse a motivo Poké Ball / Master Ball. Le varianti "speciali"
// (timbri, Cosmo da confezioni promo) si includono con l'apposita opzione.
const masterCache = new Map();
let MS = null; // slot della pagina aperta
S.masterFilter = 'all';
S.masterPick = false;

const findMaster = (lang, setId) => S.masters.find(m => m.lang === lang && m.setId === setId);
const slotOwners = (lang, cardId, s) => collection().filter(i => i.lang === lang && i.cardId === cardId && (i.variant || 'normal') === s.variant && (i.finish || null) === (s.finish || null));

// Carte che stanno nell'espansione ma non fanno parte del master set:
// i tre Mew "R", "G", "B" del 30° anniversario sono carte a sé, senza numero.
const MASTER_EXCLUDE = { '30th': ['R', 'G', 'B'], 'M6a': ['R', 'G', 'B'] };
// Set che nel master set ne includono altri: la Classic Collection del 30° anniversario è nella lista
// carte del set (guida dell'ETB), quindi fa parte del suo master set.
const MASTER_EXTRA = { '30th': ['30th-c'] };
const masterSetKeys = m => [m.setId, ...(MASTER_EXTRA[m.setId] || [])].map(id => m.lang + '|' + id);
function masterSlots(data, m) {
  const out = [];
  const parts = [{ set: data.set, cards: data.cards, extra: false }, ...(data.extra || []).map(x => ({ ...x, extra: true }))];
  parts.forEach(part => {
    const official = part.set.cardCount ? part.set.cardCount.official : null;
    const skip = new Set(part.extra ? [] : MASTER_EXCLUDE[m.setId] || []);
    part.cards.filter(c => !skip.has(c.localId)).forEach(c => {
      const n = parseInt(c.localId, 10);
      const secret = !part.extra && !!(official && isFinite(n) && n > official);
      API.slotsForCard(c, m.special).forEach(s => {
        const pr = API.pricing(c, s.variant, s.finish);
        const cm = pr.cm, tcg = pr.tcg ? toEur(pr.tcg, 'USD') : null;
        // prezzo = mediana dei venduti eBay nella lingua del master set (carte sopra 3 €);
        // senza vendite: minimo Cardmarket nella lingua, poi tendenza Cardmarket, in ultimo TCGplayer
        const q = { db: 'tcgdex', lang: m.lang, cardId: c.id, name: c.name, localId: c.localId, official, setId: part.set.id, setName: part.set.name,
          variant: s.variant, finish: s.finish || null, has1st: s.has1st };
        const cheap = !worthEbay(cm, tcg);
        const med = cheap ? null : EBQ.get(q);
        // mediana non plausibile rispetto al prezzo Cardmarket: come se non ci fossero vendite
        const suspect = !!(med && med.n && med.m != null && !ebayOk(med.m, cm, tcg));
        const exact = !!(med && med.n && med.m != null) && !suspect;
        const noSales = !!(med && !med.n) || suspect;
        const opt = minOpt(c, s);
        const cmin = noSales && cm && cm.idProduct ? CMMIN.get(cm.idProduct, m.lang, opt) : null;
        // anche il minimo Cardmarket nella lingua deve essere plausibile (una sola offerta fuori mercato non conta)
        const byCm = !!(cmin && cmin.p != null && ebayOk(cmin.p, cm, tcg));
        const cmTrend = unitValue({ cm, source: 'cm_trend' });
        const byTcg = !exact && !byCm && cmTrend == null && tcg != null;
        const price = exact ? med.m : byCm ? cmin.p : cmTrend != null ? cmTrend : tcg;
        out.push({ card: c, ...s, secret, extra: part.extra, partSet: part.set, official, cm, tcg, q, opt, exact, byCm, byTcg, cheap, noSales, suspect, sales: med ? med.n : 0, price });
      });
    });
  });
  return out;
}

// set incluso in un altro master set (es. 30th-c → 30th)
const masterParent = setId => Object.keys(MASTER_EXTRA).find(p => MASTER_EXTRA[p].includes(setId)) || null;
function viewMaster(v, args) {
  if (args[0] && args[1] && masterParent(args[1])) { location.hash = `#/master/${args[0]}/${masterParent(args[1])}`; return; }
  if (args[0] && args[1]) return viewMasterSet(v, args[0], args[1]);
  const lang = S.sets.lang || S.settings.cardLang;
  v.innerHTML = `
  <div class="page-head">
    <div><h1>${t('nav_master')}</h1><div class="sub">${t('master_hint')}</div></div>
    <button class="btn primary" data-act="master-pick">${icon('plus')} ${t('master_new')}</button>
  </div>
  ${S.masterPick ? `<div class="panel picker">
    <div class="panel-head"><h3>${t('master_pick')}</h3>
      <div class="toolbar"><input class="inp" data-sf placeholder="${esc(t('setSearch'))}" value="${esc(S.sets.filter)}">
      <select class="inp" data-act-change="sets-lang">${CARD_LANGS.map(l => `<option value="${l}" ${lang === l ? 'selected' : ''}>${LANG_BADGE[l]} · ${t('lang_' + l)}</option>`).join('')}</select></div></div>
    <div id="setGrid"><div class="loading"><span class="spinner"></span></div></div>
  </div>` : ''}
  ${S.masters.length ? `<div class="masters">${S.masters.map(m => {
    const st = m.stats || {};
    const p = st.total ? st.owned / st.total : 0;
    return `<a class="panel master-card" href="#/master/${m.lang}/${encodeURIComponent(m.setId)}">
      <div class="mc-logo">${masterLogoHtml(m) || `<b>${esc(m.setName || m.setId)}</b>`}</div>
      <div class="mc-info">
        <div class="mc-name">${esc(m.setName || m.setId)} <span class="chip tiny">${LANG_BADGE[m.lang]}</span></div>
        <div class="prog"><i style="width:${p * 100}%"></i></div>
        <div class="mc-meta"><span>${st.total ? `${st.owned}/${st.total} · ${Math.round(p * 100)}%` : '…'}</span>
          ${st.total ? `<span>${t('ms_value')}: <b>${st.est != null ? money(st.est) : '—'}</b></span>` : ''}</div>
      </div></a>`;
  }).join('')}</div>` : (!S.masterPick ? `<div class="empty">${icon('master')}<h2>${t('master_empty')}</h2><p>${t('master_hint')}</p></div>` : '')}`;
  fillMasterLogos();
  if (S.masterPick) {
    API.getSets(lang).then(list => { S.sets.list = list; S.sets.lang = lang; renderSetGrid('master'); })
      .catch(() => { const g = $('#setGrid'); if (g) g.innerHTML = `<p class="err">${t('offline')}</p>`; });
  }
}

async function viewMasterSet(v, lang, setId) {
  let m = findMaster(lang, setId);
  if (!m) { m = { id: uid(), lang, setId, setName: '', logo: '', special: false, createdAt: Date.now() }; S.masters.push(m); save(); }
  const key = lang + '|' + setId;
  let data = masterCache.get(key);
  if (!data) {
    v.innerHTML = `<a class="back" href="#/master">← ${t('nav_master')}</a><div class="loading"><span class="spinner"></span><span id="mprog">${t('master_loading')}</span></div>`;
    try {
      data = await API.getSetFull(lang, setId, (d, n) => { const e = $('#mprog'); if (e) e.textContent = `${t('master_loading')} ${d}/${n}`; });
      // set inclusi (es. Classic Collection nel 30° anniversario)
      if (data) {
        data.extra = [];
        for (const id of MASTER_EXTRA[setId] || []) {
          const x = await API.getSetFull(lang, id, (d, n) => { const e = $('#mprog'); if (e) e.textContent = `${t('master_loading')} ${d}/${n}`; }).catch(() => null);
          if (x) data.extra.push(x);
        }
      }
    } catch { data = null; }
    if (!data) { v.innerHTML = `<a class="back" href="#/master">← ${t('nav_master')}</a><p class="err">${t('offline')}</p>`; return; }
    masterCache.set(key, data);
    const r = route(); if (r.name !== 'master' || r.args[0] !== lang || r.args[1] !== setId) return;
  }
  const set = data.set;
  m.setName = set.name; m.logo = set.logo || '';
  const slots = masterSlots(data, m).map(s => ({ ...s, owners: slotOwners(lang, s.card.id, s) }));
  MS = { lang, setId, slots, set };
  // Master set = album (carte che hai e che mancano). Il valore lo scrivi tu, guardando gli annunci eBay
  // con il link di ricerca "masterset <espansione> <lingua>": nessuna ricerca automatica.
  const owned = slots.filter(s => s.owners.length), missing = slots.filter(s => !s.owners.length);
  const base = slots.filter(s => !s.secret && !s.extra), secret = slots.filter(s => s.secret);
  const extras = (data.extra || []).map(x => ({ set: x.set, slots: slots.filter(s => s.extra && s.partSet === x.set) }));
  const est = m.value > 0 ? m.value : null;
  m.stats = { owned: owned.length, total: slots.length, value: est, missing: null, est, ver: 2 };
  saveAuto();  const f = S.masterFilter;
  const show = s => f === 'all' || (f === 'missing' ? !s.owners.length : s.owners.length);
  const tile = s => {
    const i = slots.indexOf(s), c = s.card, own = s.owners.reduce((a, o) => a + (o.qty || 1), 0);
    return `<div class="tile slot ${own ? 'owned' : 'dim'}" data-act="slot" data-i="${i}" tabindex="0" role="button" title="${esc(own ? t('details') : t('master_clickAdd'))}">
      <div class="tile-img ${c.image ? '' : 'ph'}">${cardImg(c.image, lang + '|' + s.partSet.id + '|' + c.localId)}
        <div class="badges">${own ? `<span class="b own">✓${own > 1 ? ' ' + own : ''}</span>` : ''}${!isPlain(s) ? `<span class="b v ${s.finish ? 'ball' : ''}">${esc(variantLabel(s))}</span>` : ''}</div>
        ${own ? '' : `<span class="addbtn">${icon('plus')}</span>`}
      </div>
      <div class="tile-body"><div class="tile-name">${esc(c.name)}</div><div class="tile-sub">${numLabel({ localId: c.localId, official: s.official, cardId: c.id })}</div></div>
    </div>`;
  };
  const section = (title, arr) => {
    const vis = arr.filter(show);
    if (!arr.length) return '';
    const o = arr.filter(s => s.owners.length).length;
    return `<div class="msec"><div class="msec-head"><h3>${title}</h3><span class="muted">${o}/${arr.length}</span>
      <div class="prog"><i style="width:${o / arr.length * 100}%"></i></div></div>
      ${vis.length ? `<div class="grid">${vis.map(tile).join('')}</div>` : `<p class="muted small">✓</p>`}</div>`;
  };
  v.innerHTML = `
  <a class="back" href="#/master">← ${t('nav_master')}</a>
  <div class="set-hero">
    ${set.logo ? `<img class="set-hero-logo" src="${set.logo}.webp" alt="">` : (() => { const mm = S.masters.find(x => x.lang === lang && x.setId === setId); return mm && mm.logoWeb ? WEBIMG.img(mm.logoWeb, 'set-hero-logo') : ''; })()}
    <div class="set-hero-info"><h1>${esc(set.name)} <span class="chip tiny">${LANG_BADGE[lang]}</span></h1>
      <div class="sub">${t('nav_master')} · ${slots.length} ${t('master_slots')} · ${new Set(slots.map(s => s.card.id)).size} ${t('cardsIn')}</div>
      <div class="prog big"><i style="width:${owned.length / (slots.length || 1) * 100}%"></i></div>
      <div class="sub">${owned.length} ${t('of')} ${slots.length} · ${Math.round(owned.length / (slots.length || 1) * 100)}% ${t('set_progress')}</div>
    </div>
    <div class="mstats">
      <div><div class="label">${t('ms_value')}</div><div class="mid">${est != null ? money(est) : '—'}</div>${m.valueAt ? `<div class="muted small">${fmtDate(m.valueAt)}</div>` : ''}</div>
    </div>
  </div>
  <div class="panel ms-est">
    <div class="src-head"><b>${t('ms_valueTitle')}</b></div>
    <p class="muted small">${t('ms_valueHint')}</p>
    <form class="ebay-form" data-form="ms-link"><input class="inp" name="q" value="${esc(masterQuery(m))}" aria-label="${t('ebayQuery')}"><button class="btn">${t('ebayOpen')} ${icon('ext', 'sm')}</button></form>
    <form class="ebay-form" data-form="ms-value"><input class="inp" name="v" type="text" inputmode="decimal" value="${est != null ? String(est).replace('.', ',') : ''}" placeholder="${esc(t('ms_valuePh'))}" aria-label="${t('ms_value')}"><button class="btn primary">${t('ms_valueSave')}</button></form>
  </div>  <div class="toolbar">
    <div class="seg">${['all', 'missing', 'owned'].map(k => `<button data-act="master-filter" data-v="${k}" class="${f === k ? 'on' : ''}">${t({ all: 'showAll', missing: 'showMissing', owned: 'owned' }[k])}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-act-change="master-special" ${m.special ? 'checked' : ''}> ${t('master_special')}</label>
    <span class="grow"></span>
    ${missing.length ? `<button class="btn primary" data-act="master-fill">${icon('check')} ${t('master_addMissing').replace('{n}', missing.length)}</button>` : `<span class="chip on">🏆 ${t('master_done')}</span>`}
    <button class="btn ghost danger" data-act="master-remove">${t('master_remove')}</button>
  </div>
  ${section(t('master_base') + (set.cardCount && set.cardCount.official ? ` (1–${set.cardCount.official})` : ''), base)}
  ${section(t('master_secret'), secret)}
  ${extras.map(x => section(esc(x.set.name), x.slots)).join('')}`;
}

// ---------- Valore del master set (scritto a mano) ----------
// Link alla ricerca eBay degli annunci IN VENDITA "masterset <espansione> <lingua>" (es. "masterset 151 italiano"):
// guardi i prezzi e scrivi il valore nell'app. Nessuna ricerca automatica.
const MS_LANG = { it: 'italiano', en: 'english', ja: 'japanese', fr: 'francais', de: 'deutsch', es: 'español', pt: 'português', ko: 'korean', zh: 'chinese' };
const masterQueryAuto = m => `masterset ${m.setName || m.setId} ${MS_LANG[m.lang] || ''}`.replace(/\s+/g, ' ').trim();
const masterQuery = m => m.estQuery || masterQueryAuto(m);
function slotDraft(s) {
  const d = draftFromCard(s.card, MS.lang);
  if (!s.card.set || s.extra) { d.setId = s.partSet.id; d.setName = s.partSet.name; d.official = s.official; }
  d.variant = s.variant; d.finish = s.finish || null; d.finishLabel = s.finishLabel || null;
  d.condition = 'NM';
  // fonte del prezzo: quella scelta in Impostazioni (niente ricerche eBay automatiche per ogni carta)
  d.source = 'auto'; d.masterId = MS.lang + '|' + MS.setId;
  applyCardData(d, s.card); d.history = [];
  return d;
}

// ---------- SEALED ----------
// ---------- immagini dal web (Bulbapedia): logo dei master set e foto del sigillato ----------
const WEB_RETRY = 30 * 864e5; // se non trova niente riprova dopo 30 giorni
const masterLogoHtml = m => m.logo ? `<img src="${m.logo}.webp" alt="" loading="lazy">` : m.logoWeb ? WEBIMG.img(m.logoWeb) : '';
const sealedImgHtml = p => p.photo ? `<img src="${p.photo}" alt="">` : p.webPhoto ? WEBIMG.img(p.webPhoto) : p.setLogo ? `<img class="logo" src="${p.setLogo}.webp" alt="">` : p.webLogo ? WEBIMG.img(p.webLogo, 'logo') : icon('sealed');
const sealedWebKey = p => [p.type, p.setId || p.name, p.lang].join('|');
let fillingLogos = false, fillingPhotos = false;
async function fillMasterLogos() {
  const todo = S.masters.filter(m => !m.logo && !m.logoWeb && !(m.logoTry && Date.now() - m.logoTry < WEB_RETRY));
  if (fillingLogos || !todo.length) return;
  fillingLogos = true;
  let en = null; try { en = await API.setsMap('en'); } catch { /* offline */ }
  let changed = false;
  for (const m of todo) {
    const e = en && en.get(m.setId);
    // prima il logo inglese di TCGdex (stesso set), poi Bulbapedia
    const url = e && e.logo && m.lang !== 'ja' ? e.logo + '.webp'
      : await WEBIMG.setLogo({ lang: m.lang, name: m.setName || m.setId, enName: e && e.name, setId: m.setId }).catch(() => null);
    m.logoTry = Date.now();
    if (url) { m.logoWeb = url; changed = true; }
  }
  fillingLogos = false; saveAuto();
  if (changed && !M && ['master', 'collection'].includes(route().name)) render();
}
async function fillSealedPhotos() {
  const todo = S.sealed.filter(p => !p.photo && p.type !== 'other' &&
    (p.webKey !== sealedWebKey(p) ? true : !p.webPick && !p.webPhoto && !(p.webTry && Date.now() - p.webTry < WEB_RETRY)));
  if (fillingPhotos || !todo.length) return;
  fillingPhotos = true;
  let en = null; try { en = await API.setsMap('en'); } catch { /* offline */ }
  let changed = false;
  for (const p of todo) {
    const e = en && p.setId ? en.get(p.setId) : null;
    const url = await WEBIMG.product({ lang: p.lang, type: p.type, name: p.setName || p.name, enName: e && e.name, setId: p.setId }).catch(() => null);
    p.webTry = Date.now(); p.webKey = sealedWebKey(p); p.webPick = false;
    if (url !== (p.webPhoto || null)) { p.webPhoto = url || ''; changed = true; }
    // nessuna foto del prodotto: almeno il logo del set
    if (!url && p.setId && !p.setLogo && !p.webLogo) {
      p.webLogo = e && e.logo && p.lang !== 'ja' ? e.logo + '.webp'
        : await WEBIMG.setLogo({ lang: p.lang, name: p.setName || p.setId, enName: e && e.name, setId: p.setId }).catch(() => null) || '';
      if (p.webLogo) changed = true;
    }
  }
  fillingPhotos = false; saveAuto();
  if (changed && !M && route().name === 'sealed') render();
}

const SEALED_TYPES = ['booster_box', 'half_box', 'etb', 'pc_etb', 'booster_bundle', 'upc', 'premium', 'collection', 'tin', 'mini_tin', 'blister3', 'blister1', 'booster', 'build_battle', 'other'];
const SEALED_KW = { booster_box: { it: 'display', def: 'booster box' }, half_box: { def: 'booster box 18' }, etb: { def: 'elite trainer box' }, pc_etb: { def: 'pokemon center elite trainer box' },
  booster_bundle: { def: 'booster bundle' }, upc: { def: 'ultra premium collection' }, premium: { def: 'premium collection' }, collection: { def: 'collection' },
  tin: { def: 'tin' }, mini_tin: { def: 'mini tin' }, blister3: { def: 'blister' }, blister1: { def: 'blister' }, booster: { def: 'booster' }, build_battle: { def: 'build battle' }, other: { def: '' } };
const sealedAutoName = d => [d.setName, t('stype_' + d.type)].filter(Boolean).join(' – ');
function legacySealedQuery(d) {
  const kw = SEALED_KW[d.type] || { def: '' };
  const setPart = d.lang === 'ja' && d.setId ? d.setId : (d.setName || d.name);
  return [setPart, kw[d.lang] || kw.def].filter(Boolean).join(' ').trim();
}
// La lingua va sempre nella ricerca: senza, eBay mescola prezzi di edizioni diverse (es. JP vs ENG).
function sealedQuery(d) {
  // i prodotti giapponesi su eBay si trovano meglio con il codice del set (es. "sv8a booster box")
  return `${legacySealedQuery(d)} ${ebayLang(d.lang)}`.trim();
}
function sealedQ(d) {
  const eb = d.ebay;
  if (!eb || !eb.query) return sealedQuery(d);
  const custom = eb.custom != null ? eb.custom : eb.query !== legacySealedQuery(d);
  return custom ? eb.query : sealedQuery(d);
}

// ricerca del prodotto nel catalogo Cardmarket (nomi in inglese: usa il nome inglese dell'espansione)
const CM_SEALED_KW = { booster_box: 'booster box', half_box: 'booster box', etb: 'elite trainer box', pc_etb: 'pokemon center elite trainer box', booster_bundle: 'booster bundle',
  upc: 'ultra premium', premium: 'premium collection', collection: 'collection', tin: 'tin', mini_tin: 'mini tin', blister3: 'blister', blister1: 'blister', booster: 'booster', build_battle: 'build battle', other: '' };
function cmSealedQuery(d) {
  const en = M && M.enSets && d.setId ? M.enSets.get(d.setId) : null;
  return [en ? en.name : d.setName, CM_SEALED_KW[d.type]].filter(Boolean).join(' ').trim();
}
async function runCmSealed(q) {
  M.cmq = q; M.cmLoading = true; renderSealedModal();
  const ok = await CM.load();
  if (!M || M.kind !== 'sealed') return;
  M.cmLoading = false; M.cmRes = ok ? CM.search(q, 'sealed', 40) : [];
  renderSealedModal();
}

function viewSealed(v) {
  const st = sealedTotals();
  const list = [...S.sealed].sort((a, b) => (sealedUnit(b) || 0) * (b.qty || 1) - (sealedUnit(a) || 0) * (a.qty || 1));
  v.innerHTML = `
  <div class="page-head">
    <div><h1>${t('nav_sealed')}</h1>${st.n ? `<div class="sub">${st.n} ${t('sealed_items')} · <b>${money(st.value)}</b>${st.cost ? ` · ${t('gain')} <span class="${st.costKnownValue - st.cost >= 0 ? 'pos' : 'neg'}">${money(st.costKnownValue - st.cost)}</span>` : ''}</div>` : ''}</div>
    <button class="btn primary" data-act="sealed-new">${icon('plus')} ${t('sealed_add')}</button>
  </div>
  ${list.length ? `<div class="grid sealed-grid">${list.map(p => {
    const u = sealedUnit(p);
    const g = p.buyPrice != null && u != null ? u / p.buyPrice - 1 : null;
    return `<button class="tile" data-act="open-sealed" data-uid="${p.uid}">
      <div class="sealed-img ${p.photo || p.webPhoto ? 'photo' : ''}">${sealedImgHtml(p)}
        <div class="badges">${(p.qty || 1) > 1 ? `<span class="b qty">×${p.qty}</span>` : ''}<span class="b">${LANG_BADGE[p.lang] || p.lang}</span></div>
        <span class="stype">${esc(t('stype_' + p.type))}</span>
      </div>
      <div class="tile-body"><div class="tile-name">${esc(p.name)}</div>
        <div class="tile-price">${money(u)} ${pct(g)}</div>
        ${p.source === 'ebay' ? `<div class="tile-sub">${p.ebay && p.ebay.count ? `eBay · ${p.ebay.count} ${t('ebaySales')}` : sealedBusy ? t('ebaySearching') : 'eBay · —'}</div>` : ''}</div>
    </button>`;
  }).join('')}</div>` : `<div class="empty">${icon('sealed')}<h2>${t('sealed_empty')}</h2><p>${t('sealed_hint')}</p></div>`}`;
  fillSealedPhotos();
}

async function openSealed(uidv) {
  const ex = uidv ? S.sealed.find(p => p.uid === uidv) : null;
  const d = ex ? JSON.parse(JSON.stringify(ex)) : {
    uid: null, name: '', nameAuto: true, type: 'etb', lang: S.settings.cardLang, setId: '', setName: '', setLogo: '',
    qty: 1, buyPrice: null, buyDate: today(), value: null, source: 'ebay', photo: '', notes: '', addedAt: Date.now()
  };
  if (!ex) d.name = sealedAutoName(d);
  M = { kind: 'sealed', draft: d, isNew: !ex, sets: [] };
  document.body.classList.add('noscroll');
  renderSealedModal();
  loadSealedSets();
}
async function loadSealedSets() {
  if (!M || M.kind !== 'sealed') return;
  const d = M.draft;
  try { M.sets = [...await API.getSets(d.lang)].reverse(); } catch { M.sets = []; }
  try { M.enSets = await API.setsMap('en'); } catch { M.enSets = null; }
  if (M && M.kind === 'sealed' && M.draft === d) renderSealedModal();
}

function renderSealedModal() {
  const d = M.draft;
  const u = sealedUnit(d);
  const eb = d.ebay;
  const ebs = eb && eb.results ? EBAY.stats(eb.results, eb.excluded || [], eb.included || []) : null;
  const q = sealedQ(d);
  const cmUrl = `https://www.cardmarket.com/${S.settings.uiLang === 'ja' ? 'en' : S.settings.uiLang}/Pokemon/Products/Search?searchString=${encodeURIComponent(d.setName || d.name)}`;
  const still = $('#modal .modal') ? 'still' : '';
  const keepScroll = $('#modal .overlay') ? $('#modal .overlay').scrollTop : 0;
  setTimeout(() => { if (still && $('#modal .overlay')) $('#modal .overlay').scrollTop = keepScroll; });
  $('#modal').innerHTML = `
  <div class="overlay ${still}" data-act="close-modal">
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(d.name)}">
      <button class="iconbtn mclose" data-act="close-modal" title="${t('close')}">${icon('close')}</button>
      <div class="m-left">
        <div class="sealed-photo">${sealedImgHtml(d)}</div>
        <div class="btns">
          <button type="button" class="btn" data-act="s-webpics">${icon('search')} ${t('sealed_webPhoto')}</button>
          <label class="btn">${t('sealed_photo')}<input type="file" id="sealedPhoto" accept="image/*" hidden></label>
          ${d.photo || d.webPhoto ? `<button type="button" class="btn ghost" data-act="s-photo-remove">${t('remove')}</button>` : ''}
        </div>
        ${M.webPics ? `<div class="webpics-box">${M.webPics === 'loading' ? `<div class="loading"><span class="spinner"></span></div>` : M.webPics.length ? `
          <p class="muted small">${t('sealed_webHint')}</p>
          <div class="webpics">${M.webPics.map(x => `<button type="button" class="webpic ${d.webPhoto === x.url ? 'on' : ''}" data-act="s-webpick" data-u="${esc(x.url)}" title="${esc(x.title)}">${WEBIMG.img(x.url)}</button>`).join('')}</div>` : `<p class="muted small">${t('sealed_webNone')}</p>`}
          <a class="link" href="https://www.cardmarket.com/${S.settings.uiLang === 'ja' ? 'en' : S.settings.uiLang}/Pokemon/Products/Search?searchString=${encodeURIComponent(cmSealedQuery(d))}" target="_blank" rel="noopener">${t('sealed_webCm')} ${icon('ext', 'sm')}</a></div>` : ''}
      </div>
      <div class="m-right">
        <div class="m-head"><h2>${esc(d.name || t('sealed_add'))}</h2>
          <div class="m-meta"><span>${esc(t('stype_' + d.type))}</span><span class="chip tiny">${LANG_BADGE[d.lang]}</span></div></div>
        <div class="m-value">
          <div><div class="label">${t('value')} · ${t(d.source === 'ebay' ? 'src_ebay' : 'src_manual')}</div>
            <div class="big">${u != null ? money(u) : `<span class="muted">${t('noPrice')}</span>`}</div>
            ${d.source === 'ebay' ? `<div class="muted small">${d.ebay && d.ebay.count ? `${t('ebayMedian')} · ${d.ebay.count} ${t('ebaySales')} · ${fmtDate(d.ebay.at)}` : t('sealed_ebayHint')}</div>` : ''}</div>
          ${(d.qty || 1) > 1 && u != null ? `<div class="r"><div class="label">${t('total')} ×${d.qty}</div><div class="mid">${money(u * d.qty)}</div></div>` : ''}
        </div>
        <form class="copy" data-form="sealed">
          <div class="fgrid">
            <label class="field"><span>${t('sealed_type')}</span><select class="inp" name="type">${SEALED_TYPES.map(k => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${esc(t('stype_' + k))}</option>`).join('')}</select></label>
            <label class="field"><span>${t('language')}</span><select class="inp" name="lang">${CARD_LANGS.map(l => `<option value="${l}" ${d.lang === l ? 'selected' : ''}>${LANG_BADGE[l]} · ${t('lang_' + l)}</option>`).join('')}</select></label>
            <label class="field"><span>${t('set')}</span><select class="inp" name="setId"><option value="">${t('sealed_noSet')}</option>${(M.sets.length ? M.sets : d.setId ? [{ id: d.setId, name: d.setName }] : []).map(s => `<option value="${esc(s.id)}" ${d.setId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
            <label class="field wide"><span>${t('sealed_name')}</span><input class="inp" name="name" value="${esc(d.name)}"></label>
            <label class="field"><span>${t('qty')}</span><input class="inp" name="qty" type="number" min="1" step="1" value="${d.qty || 1}"></label>
            <label class="field"><span>${t('buyPrice')} (€)</span><input class="inp" name="buyPrice" inputmode="decimal" value="${d.buyPrice ?? ''}"></label>
            <label class="field"><span>${t('buyDate')}</span><input class="inp" name="buyDate" type="date" value="${esc(d.buyDate || '')}"></label>
            <label class="field"><span>${t('priceSource')}</span><select class="inp" name="source">${[['ebay', 'src_ebay'], ['cm', 'src_cm_trend'], ['manual', 'src_manual']].map(([v, k]) => `<option value="${v}" ${d.source === v ? 'selected' : ''}>${t(k)}</option>`).join('')}</select></label>
            <label class="field"><span>${t('sealed_value')} (€)</span><input class="inp" name="value" inputmode="decimal" value="${d.value ?? ''}"></label>
            <label class="field wide"><span>${t('notes')}</span><input class="inp" name="notes" value="${esc(d.notes || '')}"></label>
          </div>
        </form>
        <div class="sources">
          <div class="src">
            <div class="src-head"><b>${t('cmTitle')}</b>${d.cm && d.cm.updated ? `<span class="muted small">${t('updatedAt')} ${fmtDate(d.cm.updated)}</span>` : ''}</div>
            ${!CM.canLoad ? `<p class="muted small">${t(cmNoExtKey())}</p>` : `
              ${d.cmId ? `<div class="cm-linked"><b>${esc(d.cmName || '#' + d.cmId)}</b>
                <a class="link" href="https://www.cardmarket.com/${S.settings.uiLang === 'ja' ? 'en' : S.settings.uiLang}/Pokemon/Products?idProduct=${d.cmId}" target="_blank" rel="noopener">${t('openCardmarket')} ${icon('ext', 'sm')}</a>
                <button type="button" class="btn ghost" data-act="s-cm-unlink">${t('remove')}</button></div>
                ${d.cm ? `<div class="stats"><div class="stat strong"><span>${t('cm_trend')}</span><b>${money(d.cm.trend)}</b></div><div class="stat"><span>${t('cm_avg30')}</span><b>${money(d.cm.avg30)}</b></div><div class="stat"><span>${t('cm_lowAll')}</span><b>${money(d.cm.low)}</b></div></div>` : ''}` :
                `<p class="muted small">${t('cm_linkHint')}</p>`}
              <form class="ebay-form" data-form="cmsealed"><input class="inp" name="q" value="${esc(M.cmq || cmSealedQuery(d))}"><button class="btn">${t('search')}</button></form>
              ${M.cmLoading ? `<div class="loading small"><span class="spinner"></span>${t('cm_loading')}</div>` : ''}
              ${M.cmRes ? (M.cmRes.length ? `<div class="cmlist small">${M.cmRes.map(c => { const p = CM.priceOf(c.idProduct, false); return `
                <div class="cmrow" data-act="s-cm-pick" data-id="${c.idProduct}" role="button" tabindex="0"><div class="cm-name"><b>${esc(c.name)}</b></div><div class="cm-price">${p ? money(p.trend || p.avg30) : '—'}</div></div>`; }).join('')}</div>` : `<p class="muted small">${t('noResults')}</p>`) : ''}`}
          </div>
          <div class="src ebay">
            <div class="src-head"><b>${t('ebayTitle')}</b>${eb && eb.at ? `<span class="muted small">${t('updatedAt')} ${fmtDate(eb.at)}</span>` : ''}
              <a class="link" href="${EBAY.url(S.settings.ebayDomain, q, '2536')}" target="_blank" rel="noopener">${t('ebayOpen')} ${icon('ext', 'sm')}</a>
              <a class="link" href="${cmUrl}" target="_blank" rel="noopener">${t('openCardmarket')} ${icon('ext', 'sm')}</a></div>
            <form class="ebay-form" data-form="ebay"><input class="inp" name="q" value="${esc(q)}" aria-label="${t('ebayQuery')}"><button class="btn" id="ebayBtn">${t('ebaySearch')}</button></form>
            <div id="ebayOut">${ebayOutHtml(d, ebs)}</div>
          </div>
        </div>
        <div class="m-actions">
          ${M.isNew ? `<button type="button" class="btn primary" data-act="s-add">${icon('plus')} ${t('sealed_add')}</button>` :
            `<button type="button" class="btn primary" data-act="s-save">${t('save')}</button><button type="button" class="btn ghost danger" data-act="s-remove">${t('remove')}</button>`}
        </div>
      </div>
    </div>
  </div>`;
}

function readSealedForm() {
  const f = $('form[data-form="sealed"]'); if (!f || !M) return null;
  const d = M.draft, fd = new FormData(f);
  const prevLang = d.lang;
  const typed = (fd.get('name') || '').trim();
  if (typed !== d.name) d.nameAuto = !typed;
  d.type = fd.get('type'); d.lang = fd.get('lang');
  d.setId = d.lang === prevLang ? fd.get('setId') : '';
  const s = M.sets.find(x => x.id === d.setId);
  d.setName = d.setId ? (s ? s.name : d.setName) : ''; d.setLogo = d.setId ? (s ? s.logo || '' : d.setLogo) : '';
  d.name = d.nameAuto ? sealedAutoName(d) : typed;
  d.qty = Math.max(1, parseInt(fd.get('qty'), 10) || 1);
  d.buyPrice = num(fd.get('buyPrice')); d.buyDate = fd.get('buyDate');
  d.source = fd.get('source'); d.value = num(fd.get('value')); d.notes = fd.get('notes');
  return { langChanged: d.lang !== prevLang };
}

async function resizePhoto(file) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

// ---------- IMPOSTAZIONI ----------
function viewSettings(v) {
  const st = S.settings;
  const sel = (key, opts) => `<select class="inp" data-set="${key}">${opts.map(([val, lab]) => `<option value="${val}" ${st[key] === val ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  v.innerHTML = `
  <div class="page-head"><div><h1>${t('nav_settings')}</h1></div></div>
  <div class="settings">
    <div class="panel">
      <label class="field"><span>${t('settings_ui')}</span>${sel('uiLang', [['it', 'Italiano'], ['en', 'English'], ['ja', '日本語']])}</label>
      <label class="field"><span>${t('settings_cardLang')}</span>${sel('cardLang', CARD_LANGS.map(l => [l, t('lang_' + l)]))}</label>
      <label class="field"><span>${t('settings_currency')}</span>${sel('currency', [['EUR', 'Euro (€)'], ['USD', 'US Dollar ($)'], ['GBP', 'Pound (£)'], ['JPY', 'Yen (¥)']])}</label>
      <label class="field"><span>${t('settings_source')}</span>${sel('source', SOURCES.filter(s => s !== 'manual').map(s => [s, t('src_' + s)]))}</label>
      <label class="field"><span>${t('settings_ebay')}</span>${sel('ebayDomain', ['ebay.it', 'ebay.de', 'ebay.fr', 'ebay.es', 'ebay.com', 'ebay.co.uk'].map(d => [d, d]))}</label>
      <label class="field"><span>${t('settings_theme')}</span>${sel('theme', [['dark', t('theme_dark')], ['light', t('theme_light')]])}</label>
    </div>
    <div class="panel">
      <h3>${icon('cloud')} Google Drive</h3>
      <p class="muted small">${t('drive_hint')}</p>
      <p class="small" id="driveStatus">${driveStatusHtml()}</p>
      <div class="btns">
        <button class="btn primary" data-act="drive-sync" ${DRIVE.configured() ? '' : 'disabled'}>${icon('cloud')} ${DRIVE.everSynced() ? t('drive_syncNow') : t('drive_connect')}</button>
        ${DRIVE.everSynced() ? `<button class="btn ghost" data-act="drive-logout">${t('drive_logout')}</button>` : ''}
      </div>
      <details class="small"${DRIVE.configured() ? '' : ' open'}><summary>${t('drive_clientTitle')}</summary>
        <label class="field"><span>${t('drive_clientId')}</span><input class="inp" data-set="gClientId" value="${esc(st.gClientId || '')}" placeholder="${esc((window.VETRINA_CONFIG && VETRINA_CONFIG.googleClientId) || '…apps.googleusercontent.com')}" autocomplete="off" spellcheck="false"></label>
        <p class="muted small">${t('drive_clientHint').replace('{o}', esc(location.origin))}</p>
      </details>
    </div>
    <div class="panel">
      <h3>${t('settings_data')}</h3>
      <div class="btns">
        <button class="btn" data-act="export-json">${t('exportJson')}</button>
        <button class="btn" data-act="import-json">${t('importJson')}</button>
        <button class="btn" data-act="export-csv">${t('exportCsv')}</button>
        <button class="btn danger" data-act="clear-all">${t('clearAll')}</button>
      </div>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
      <p class="note ${EBAY.isExt ? 'ok' : 'warn'}">${EBAY.isExt ? t('extOk') : t('extNo')}</p>
      <h3>${t('cm_catalog')}</h3>
      ${CM.canLoad ? (() => { const c = CM.counts; return `
        <p class="muted small">${c ? t('cm_status').replace('{s}', c.singles.toLocaleString(locale())).replace('{p}', c.sealed.toLocaleString(locale())).replace('{d}', fmtDate(c.prices || c.at)).replace('{n}', c.named) : t('cm_notLoaded')}</p>
        <div class="btns"><button class="btn" data-act="cm-refresh">${t('cm_refresh')}</button><button class="btn" data-act="cm-import-names">${t('cm_importNames')}</button></div>
        <p class="muted small">${t('cm_importHint')}</p>`; })() : `<p class="note warn">${t(cmNoExtKey())}</p>`}
      <h3>${t('sources_title')}</h3><p class="muted">${t('sources_text')}</p>
      <p class="muted small"><b>NidoCollection ${APP_VERSION}</b></p>
      <p class="muted small">Pokémon e i nomi correlati sono marchi di Nintendo, Creatures e GAME FREAK. App personale non ufficiale.</p>
    </div>
  </div>`;
}

// ---------- SCHEDA CARTA (modale) ----------
let M = null; // { draft, card, isNew }

function defaultVariant(card) {
  const v = (card && card.variants) || {};
  return ['normal', 'holo', 'reverse', 'firstEdition'].find(k => v[k]) || 'normal';
}
function draftFromCard(card, lang, listName = 'collection') {
  const setId = card.set ? card.set.id : API.setIdOf(card);
  const it = {
    uid: null, list: listName, lang, cardId: card.id, name: card.name, setId, setName: card.set ? card.set.name : setId,
    localId: card.localId, official: card.set && card.set.cardCount ? card.set.cardCount.official : null, rarity: card.rarity || '',
    image: card.image || null, variant: defaultVariant(card), condition: 'NM', grade: { co: '', g: '' }, qty: 1,
    buyPrice: null, buyDate: today(), notes: '', targetPrice: null, source: 'auto', manualPrice: null, history: [], addedAt: Date.now()
  };
  applyCardData(it, card); it.history = [];
  return it;
}
function sameKey(a, b) {
  return a.list === b.list && a.lang === b.lang && a.cardId === b.cardId && a.variant === b.variant && (a.finish || null) === (b.finish || null) && a.condition === b.condition &&
    (a.grade && a.grade.co || '') === (b.grade && b.grade.co || '') && String(a.grade && a.grade.g || '') === String(b.grade && b.grade.g || '') && isBlackLabel(a) === isBlackLabel(b);
}
function addItem(draft) {
  const ex = S.items.find(i => sameKey(i, draft));
  if (ex) { ex.qty = (ex.qty || 1) + (draft.qty || 1); return ex; }
  const it = { ...draft, uid: uid(), addedAt: Date.now() };
  const u = unitValue(it); it.history = u != null ? [[today(), u]] : [];
  S.items.push(it);
  return it;
}

function applySlot(d, card, slot) {
  if (!slot) return d;
  d.variant = slot.variant; d.finish = slot.finish || null; d.finishLabel = slot.finishLabel || null;
  applyCardData(d, card); d.history = [];
  return d;
}
async function quickAdd(lang, id, btn, slot) {
  btn && btn.classList.add('busy');
  try {
    const card = await API.getCard(lang, id);
    const it = addItem(applySlot(draftFromCard(card, lang), card, slot));
    snapshotPortfolio(); save();
    toast(`${t('added')}: ${it.name}`);
    render();
  } catch { toast(t('offline')); btn && btn.classList.remove('busy'); }
}

async function openCard(lang, id, uidv, slot) {
  const existing = uidv ? S.items.find(i => i.uid === uidv) : null;
  $('#modal').innerHTML = `<div class="overlay" data-act="close-modal"><div class="modal loadingm"><span class="spinner"></span></div></div>`;
  document.body.classList.add('noscroll');
  let card = null;
  try { card = await API.getCard(lang, id); } catch { /* offline: usa i dati salvati */ }
  if (!card && !existing) { closeModal(); toast(t('offline')); return; }
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : applySlot(draftFromCard(card, lang), card, slot);
  if (card && existing) { const pp = API.pricing(card, draft.variant, draft.finish); draft.cm = pp.cm; draft.tcgp = pp.tcg || null; delete draft.tcg; }
  if (!draft.image && card && card.image) draft.image = card.image;
  M = { draft, card, isNew: !existing };
  renderModal();
  if (!draft.image) {
    const base = await API.fallbackImage(lang, draft.setId, draft.localId);
    if (base && M && M.draft === draft) { draft.image = base; const im = $('#modal .holo img'); if (im) { im.src = img(base, 'high'); im.parentElement.classList.remove('ph'); } }
  }
}
function closeModal() { M = null; $('#modal').innerHTML = ''; document.body.classList.remove('noscroll'); }

// Ricerca eBay: nome del Pokémon (in inglese per le carte giapponesi, come le scrivono i venditori),
// numero completo "088/087" e, per le gradate, ente e voto ("PSA 10").
// Lingua nella ricerca eBay: una parola sola nel titolo.
// Una sola parola: con il gruppo "(ita,italiano,…)" eBay non trovava risultati.
const EBAY_LANG = { it: 'ita', en: 'english', ja: 'japanese', fr: 'french', de: 'german', es: 'spanish', pt: 'portuguese', ko: 'korean', zh: 'chinese' };
const ebayLang = l => EBAY_LANG[l] || '';
// Classic Collection (30° anniversario e Celebrations): ristampe di carte famose.
// Su eBay si cercano con la sigla del set ORIGINALE e il numero della carta originale, più "classic collection":
// es. Charizard del Set Base → "Charizard BS 4 (ita…) classic collection". Sigle come su Cardmarket.
const CLASSIC_ORIG = {
  '30th-c-001': 'BS 4', '30th-c-002': 'RS 5', '30th-c-003': 'DS 11', '30th-c-004': 'PLB 11', '30th-c-005': 'G1 18', '30th-c-006': 'TRR 19',
  '30th-c-007': 'N1 25', '30th-c-008': 'TEU 33', '30th-c-009': 'BKP 41', '30th-c-010': 'LA 43', '30th-c-011': 'PL 47', '30th-c-012': 'VIV 50',
  '30th-c-013': 'CIN 57', '30th-c-014': 'BS 58', '30th-c-015': 'G1 69', '30th-c-016': 'DRX 85', '30th-c-017': 'SUM 89', '30th-c-018': 'TM 94',
  '30th-c-019': 'TM 99', '30th-c-020': 'TM 100', '30th-c-021': 'NVI 101', '30th-c-022': 'GE 106', '30th-c-023': 'PRC 106', '30th-c-024': 'N4 106',
  '30th-c-025': 'UF 108', '30th-c-026': 'FST 114', '30th-c-027': 'BRS 123', '30th-c-028': 'SSH 138', '30th-c-029': 'AQ 149', '30th-c-030': 'PAL 203',
  'cel25cc-CC001': 'BS 2', 'cel25cc-CC002': 'BS 4', 'cel25cc-CC003': 'BS 15', 'cel25cc-CC004': 'BS 73', 'cel25cc-CC005': 'TR 8', 'cel25cc-CC006': 'TR 15',
  'cel25cc-CC007': 'G2 15', 'cel25cc-CC008': 'PR 24', 'cel25cc-CC009': 'N1 20', 'cel25cc-CC010': 'N3 66', 'cel25cc-CC011': 'MA 9', 'cel25cc-CC012': 'TRR 86',
  'cel25cc-CC013': 'LM 88', 'cel25cc-CC014': 'DF 93', 'cel25cc-CC015': 'P5 17', 'cel25cc-CC016': 'GE 15', 'cel25cc-CC017': 'RR 109', 'cel25cc-CC018': 'SV 145',
  'cel25cc-CC019': 'HS 107', 'cel25cc-CC020': 'BLW 113', 'cel25cc-CC021': 'BLW 114', 'cel25cc-CC022': 'NXD 54', 'cel25cc-CC023': 'XY 97', 'cel25cc-CC024': 'ROS 76',
  'cel25cc-CC025': 'GRI 60'
};
const CLASSIC_SETS = new Set(['30th-c', 'cel25cc']);
// Ricerca eBay di una carta: SOLO nome della carta + numero (es. 5/100 → "5") + nome del set nella lingua della carta
// + versione (prima edizione, reverse holo, stamped…) e, per le gradate, ente e voto. Nessun simbolo.
const noSymbols = x => String(x || '').replace(/['’`´.]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
// numero della carta senza totale e senza zeri davanti ("005" → "5"; le sigle tipo "TG05" o "SWSH050" restano)
const cardNum = d => { const id = String(d.localId || '').split('/')[0].trim(); return /^\d+$/.test(id) ? String(parseInt(id, 10)) : id; };
function variantWords(d) {
  const w = [];
  if (d.variant === 'firstEdition') w.push(d.lang === 'it' ? 'prima edizione' : '1st edition');
  if (isUnlimited(d)) w.push('unlimited');
  if (d.variant === 'reverse') w.push('reverse holo');
  const f = d.finish || '';
  if (f === 'shadowless' || f === 'shadowless1st') w.push('shadowless');
  else if (f === 'print1999') w.push('1999 2000');
  else if (/^stamp/.test(f)) w.push('stamped ' + finishLabel(f, d.finishLabel));
  else if (f && d.db !== 'topsun' && d.db !== 'custom') w.push(finishLabel(f, d.finishLabel));
  return w.join(' ');
}
function ebayQuery(d) {
  const grade = d.grade && d.grade.co ? `${d.grade.co === 'AiGrading' ? 'AI Grading' : d.grade.co} ${d.grade.g || ''}${isBlackLabel(d) ? ' Black Label' : ''}` : '';
  const q = (...parts) => noSymbols(parts.filter(Boolean).join(' '));
  if (d.db === 'topsun') return q(d.name.replace(/\s*\(Prism\)/, ''), 'Topsun', d.finish === 'prism' ? 'prism' : '', grade);
  if (d.db === 'custom') return q(d.name, cardNum(d), (d.setName || '').replace(/\s*\(.*?\)/g, ''), variantWords(d), grade);
  if (d.db === 'cm') {
    const sn = (d.setName && d.setName !== 'Cardmarket' ? d.setName : '').replace(/\s*\(.*?\)/g, '').replace(/^Japanese Promos$/i, 'promo');
    return q(d.name.replace(/\s*[[(].*?[\])]/g, ''), sn, variantWords(d), grade);
  }
  // Classic Collection: il numero è quello della carta ristampata (es. "30C SSH 138")
  const num = CLASSIC_SETS.has(d.setId) ? classicNum(d) || cardNum(d) : cardNum(d);
  return q(d.name, num, (d.setName || '').replace(/Collzione/g, 'Collezione'), variantWords(d), grade); // (refuso di TCGdex nel nome italiano)
}
// La ricerca salvata vale solo se l'hai scritta tu; altrimenti si rigenera (es. dopo aver cambiato il voto).
function legacyEbayQuery(d) {
  const nb = d.official ? `${d.localId}/${d.official}` : d.localId;
  return d.lang === 'ja' ? `${d.setId} ${nb}`.trim() : `${d.name} ${nb}`.trim();
}
// Ricerche generate dall'app con regole vecchie (da rifare sempre con quelle di adesso):
// - lingua a gruppo "(ita,italiano,…)", che eBay non trovava;
// - Classic Collection senza la sigla e il numero della carta originale (es. "N 101/101 classic collection").
function staleAutoQuery(d, q) {
  if (/\((?:ita|english|japanese|french|german|spanish)[a-z]*,/i.test(q)) return true;
  // regole vecchie: numero con il totale ("5/100") o la lingua in fondo
  if (/\d\/\d/.test(q) || /\b(italiano|english|japanese|japan|giapponese|inglese)\b/i.test(q)) return true;
  const code = CLASSIC_SETS.has(d.setId) && CLASSIC_ORIG[d.cardId];
  return !!(code && !q.toLowerCase().includes(code.toLowerCase()));
}
function ebayQ(d) {
  const eb = d.ebay;
  if (!eb || !eb.query) return ebayQuery(d);
  if (eb.custom !== true && staleAutoQuery(d, eb.query)) return ebayQuery(d);
  const custom = eb.custom != null ? eb.custom : eb.query !== legacyEbayQuery(d);
  return custom ? eb.query : ebayQuery(d);
}
function cardmarketUrl(d) {
  const l = S.settings.uiLang === 'ja' ? 'en' : S.settings.uiLang;
  if (d.cm && d.cm.idProduct) return `https://www.cardmarket.com/${l}/Pokemon/Products?idProduct=${d.cm.idProduct}`;
  return `https://www.cardmarket.com/${l}/Pokemon/Products/Search?searchString=${encodeURIComponent(d.name)}`;
}

function renderModal() {
  if (!M) return;
  if (M.kind === 'sealed') return renderSealedModal();
  const d = M.draft, card = M.card;
  // versioni disponibili: variante + eventuale motivo (Poké Ball, Master Ball, timbri…)
  const slotKey = s => s.variant + '|' + (s.finish || '');
  const slots = card ? API.slotsForCard(card, true) : (EXTRA_SLOTS[d.db] || []).map(s => ({ finish: null, ...s }));
  if (!slots.some(s => slotKey(s) === slotKey(d))) slots.push({ variant: d.variant, finish: d.finish || null, finishLabel: d.finishLabel, has1st: d.has1st });
  if (card) d.has1st = slots.some(s => s.variant === 'firstEdition');
  const extra = d.db && d.db !== 'tcgdex';
  const bigImg = d.photo || d.imgUrl || (d.image ? img(d.image, 'high') : '');
  // carta del catalogo Cardmarket senza immagine: la legge dalla pagina del prodotto (una volta per apertura)
  if (d.db === 'cm' && !bigImg && EBAY.isExt && !M.imgTried) {
    M.imgTried = true; M.imgLoading = true;
    CM.fetchImage(d.cmId).then(url => {
      if (!M || M.draft !== d) return;
      M.imgLoading = false;
      if (url) {
        d.imgUrl = url;
        S.items.filter(i => i.db === 'cm' && i.cmId === d.cmId && !i.imgUrl && !i.photo).forEach(i => { i.imgUrl = url; });
        saveAuto();
      }
      renderModal();
    });
  }
  // Minimo Cardmarket nella LINGUA della carta scelta (NM): il "Da" del listino mescola tutte le lingue
  // (es. Gengar tedesco più economico dell'italiano). Letto dalla pagina della carta, una volta per lingua/versione.
  const minO = card ? minOpt(card, d) : (d.cmOpt || {});
  const minId = d.cm && d.cm.idProduct;
  const minKey = minId ? [minId, d.lang, JSON.stringify(minO)].join('|') : '';
  if (minId) {
    const c = CMMIN.get(minId, d.lang, minO);
    if (c) d.cmMin = c; else if (d.cmMin && M.cmMinKey !== minKey) d.cmMin = null;
    if (!c && CMMIN.isExt && M.cmMinKey !== minKey) {
      M.cmMinKey = minKey; M.cmMinLoading = true;
      const mm = M;
      CMMIN.want(minId, d.lang, minO).then(v => {
        if (M !== mm) return;
        M.cmMinLoading = false;
        if (v && M.cmMinKey === minKey) { d.cmMin = v; if (d.uid) { const it = S.items.find(x => x.uid === d.uid); if (it) { it.cmMin = v; saveAuto(); } } }
        renderModal();
      });
    }
  }
  const minLang = d.cmMin && d.cmMin.v === CMMIN.V ? d.cmMin.p : null;
  // Fonte "venduti eBay": la ricerca della carta si fa qui, aprendola (una carta alla volta, mai in massa),
  // se non c'è o ha più di 2 mesi.
  const ebKey = [d.lang, d.cardId, d.variant, d.finish || '', ebayQ(d)].join('|');
  if (EBAY.isExt && (!d.db || d.db === 'tcgdex') && !(d.grade && d.grade.co) && effSource(d) === 'ebay_auto' && worthEbay(d.cm, tcgEur(d)) &&
      M.ebKey !== ebKey && !(d.ebay && (d.ebay.loading || (d.ebay.at && Date.now() - d.ebay.at < PRICE_TTL && d.ebay.query === ebayQ(d) && d.ebay.fv === EBAY_FV)))) {
    M.ebKey = ebKey;
    setTimeout(() => { if (M && M.draft === d) runEbay(ebayQ(d), true); }, 0);
  }
  const u = unitValue(d);
  const cm = d.cm;
  const wish = d.list === 'wishlist';
  const owned = collection().filter(i => i.lang === d.lang && i.cardId === d.cardId);
  const stat = (lab, val, strong) => `<div class="stat ${strong ? 'strong' : ''}"><span>${lab}</span><b>${money(val)}</b></div>`;
  const eb = d.ebay;
  // i filtri automatici dipendono da gradazione e lingua: ricalcolati a ogni modifica
  if (eb && eb.results) eb.results.forEach(r => { r.auto = EBAY.autoExcluded(r, d); });
  const ebs = eb && eb.results ? EBAY.stats(eb.results, eb.excluded || [], eb.included || []) : null;
  if (ebs) { eb.median = ebs.count ? ebs.median : null; eb.count = ebs.count; }

  const still = $('#modal .modal:not(.loadingm)') ? 'still' : '';
  const keepScroll = $('#modal .overlay') ? $('#modal .overlay').scrollTop : 0;
  $('#modal').innerHTML = `
  <div class="overlay ${still}" data-act="close-modal">
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(d.name)}">
      <button class="iconbtn mclose" data-act="close-modal" title="${t('close')}">${icon('close')}</button>
      <div class="m-left">
        ${isGraded(d) ? `<div class="holo slabbed" data-tilt>${slabHtml({ ...d, releaseDate: card && card.set && card.set.releaseDate }, `<div class="sl-card ${bigImg ? '' : 'ph'}">${bigImg ? `<img src="${esc(bigImg)}" alt="${esc(d.name)}">` : `<img alt="">`}</div>`)}<div class="glare"></div></div>` : `
        <div class="holo ${bigImg ? '' : 'ph'} ${d.variant !== 'normal' || /holo|rara|rare|ex|gx|v\b/i.test(d.rarity) ? 'shiny' : ''}" data-tilt>
          ${bigImg ? `<img src="${esc(bigImg)}" alt="${esc(d.name)}">` : `<img alt=""><span class="noimg">${M.imgLoading ? `<span><span class="spinner"></span> ${t('cmImgLoading')}</span>` : t('noImage')}</span>`}
          <div class="glare"></div>
        </div>`}
        ${extra ? `<div class="btns"><label class="btn">${t('sealed_photo')}<input type="file" id="cardPhoto" accept="image/*" hidden></label>
          ${d.photo ? `<button type="button" class="btn ghost" data-act="c-photo-remove">${t('remove')}</button>` : ''}</div>` : ''}
        ${owned.length ? `<div class="owned-list"><div class="label">${t('youOwn')}</div>${owned.map(o => `<button class="chip ${o.uid === d.uid ? 'on' : ''}" data-act="open-item" data-uid="${o.uid}">×${o.qty} ${esc(variantLabel(o))} ·${o.condition}${o.grade && o.grade.co ? ' · ' + esc(o.grade.co + ' ' + o.grade.g) : ''}</button>`).join('')}</div>` : ''}
      </div>
      <div class="m-right">
        <div class="m-head">
          <h2>${esc(d.name || t('custom_add'))}</h2>
          ${extra ? `<div class="muted small">${t('db_' + d.db)}</div>` : ''}
          <div class="m-meta">
            ${card && card.set && card.set.symbol ? `<img class="sym" src="${card.set.symbol}.webp" alt="">` : ''}
            <span>${esc(d.setName)}</span>${d.localId ? `<span class="dotsep">•</span><span>${numLabel(d)}</span>` : ''}
            ${d.rarity ? `<span class="dotsep">•</span><span>${esc(d.rarity)}</span>` : ''}
            <span class="chip tiny">${LANG_BADGE[d.lang]}</span>
          </div>
          ${card && card.illustrator ? `<div class="muted small">${t('illustrator')}: ${esc(card.illustrator)}</div>` : ''}
        </div>

        <div class="m-value">
          <div><div class="label">${t('price')} · ${esc(t('src_' + (d.source !== 'auto' ? d.source : (d.grade && d.grade.co ? 'ebay' : S.settings.source))))}</div>
          <div class="big">${u != null ? money(u) : `<span class="muted">${t('noPrice')}</span>`} ${pct(change7(d))}</div></div>
          ${(d.qty || 1) > 1 && u != null ? `<div class="r"><div class="label">${t('total')} ×${d.qty}</div><div class="mid">${money(u * d.qty)}</div></div>` : ''}
        </div>

        <div class="sources">
          <div class="src">
            <div class="src-head"><b>${t('cmTitle')}</b>${cm && cm.updated ? `<span class="muted small">${t('updatedAt')} ${fmtDate(cm.updated)}</span>` : ''}
              <a class="link" href="${cardmarketUrl(d)}" target="_blank" rel="noopener">${t('openCardmarket')} ${icon('ext', 'sm')}</a></div>
            ${cm ? `<div class="stats">${stat(t('cm_trend'), cm.trend, true)}${stat(t('cm_avg30'), cm.avg30)}${stat(t('cm_avg7'), cm.avg7)}${stat(t('cm_avg1'), cm.avg1)}${stat(t('cm_lowAll'), cm.low)}
              ${minId ? `<div class="stat strong" title="${esc(t('cm_minLang_hint'))}"><span>${t('cm_minLang').replace('{lang}', LANG_BADGE[d.lang] || d.lang)}</span><b>${minLang != null ? money(minLang) : M.cmMinLoading ? '<span class="spinner sm"></span>' : d.cmMin && d.cmMin.v === CMMIN.V ? t('cm_minLang_none') : '—'}</b></div>` : ''}</div>` : `<p class="muted small">${t('noPrice')}</p>`}
          </div>
          <div class="src ebay">
            <div class="src-head"><b>${t('ebayTitle')}</b>${eb && eb.at ? `<span class="muted small">${t('updatedAt')} ${fmtDate(eb.at)}</span>` : ''}
              <a class="link" href="${EBAY.url(S.settings.ebayDomain, ebayQ(d))}" target="_blank" rel="noopener">${t('ebayOpen')} ${icon('ext', 'sm')}</a></div>
            <form class="ebay-form" data-form="ebay"><input class="inp" name="q" value="${esc(ebayQ(d))}" aria-label="${t('ebayQuery')}"><button class="btn" id="ebayBtn">${t('ebaySearch')}</button></form>
            ${d.grade && d.grade.co ? `<p class="muted small">${esc(t('ebayGradedHint').replace('{g}', d.grade.co + ' ' + (d.grade.g || '') + (isBlackLabel(d) ? ' Black Label' : d.grade.co === 'BGS' && parseFloat(d.grade.g) >= 10 ? ' Pristine' : '')))}</p>` : ''}
            <div id="ebayOut">${ebayOutHtml(d, ebs)}</div>
          </div>
        </div>

        ${!M.isNew && d.history && d.history.length > 1 ? `<div class="hist"><div class="label">${t('priceHistory')}</div><div id="itemChart" class="chart small"></div></div>` : ''}

        <form class="copy" data-form="copy">
          <h3>${t('yourCopy')}</h3>
          ${extra ? `<div class="fgrid">
            <label class="field wide"><span>${t('sealed_name')}</span><input class="inp" name="cname" value="${esc(d.name)}" ${d.db === 'cm' ? '' : 'placeholder="Pikachu"'}></label>
            <label class="field"><span>${t('set')}</span><input class="inp" name="cset" list="customSets" value="${esc(d.setName)}"><datalist id="customSets">${CUSTOM_SETS.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
            <label class="field"><span>${t('number')}</span><input class="inp" name="cnum" value="${esc(d.localId || '')}"></label>
            <label class="field"><span>${t('language')}</span><select class="inp" name="clang">${CARD_LANGS.map(l => `<option value="${l}" ${d.lang === l ? 'selected' : ''}>${LANG_BADGE[l]} · ${t('lang_' + l)}</option>`).join('')}</select></label>
          </div>` : ''}
          <div class="fgrid">
            <label class="field"><span>${t('variant')}</span><select class="inp" name="variant">${slots.map(s => `<option value="${esc(slotKey(s))}" data-fl="${esc(s.finishLabel || '')}" ${slotKey(s) === slotKey(d) ? 'selected' : ''}>${esc(variantLabel(s))}</option>`).join('')}</select></label>
            <label class="field"><span>${t('condition')}</span><select class="inp" name="condition">${CONDS.map(c => `<option value="${c}" ${d.condition === c ? 'selected' : ''}>${c} – ${t('cond_' + c)}</option>`).join('')}</select></label>
            <label class="field"><span>${t('graded')}</span><select class="inp" name="gco"><option value="">${t('gradeNone')}</option>${GRADERS.map(g => `<option ${d.grade && d.grade.co === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
            <label class="field ${d.grade && d.grade.co ? '' : 'off'}"><span>${t('grade')}</span><input class="inp" name="gg" inputmode="decimal" value="${esc(d.grade && d.grade.g || '')}" placeholder="10"></label>
            ${d.grade && d.grade.co === 'BGS' && parseFloat(String(d.grade.g).replace(',', '.')) >= 10 ? `<label class="field"><span>BGS 10</span><select class="inp" name="gblack">
              <option value="">${t('bgsPristine')}</option><option value="1" ${d.grade.black ? 'selected' : ''}>${t('bgsBlack')}</option></select></label>` : ''}
            ${d.grade && d.grade.co ? `<label class="field"><span>${t('gradeCert')}</span><input class="inp" name="gcert" autocomplete="off" value="${esc(d.grade.cert || '')}" placeholder="—"></label>` : ''}
            <label class="field"><span>${t('qty')}</span><input class="inp" name="qty" type="number" min="1" step="1" value="${d.qty || 1}"></label>
            ${wish ? `<label class="field"><span>${t('targetPrice')} (€)</span><input class="inp" name="targetPrice" inputmode="decimal" value="${d.targetPrice ?? ''}"></label>` :
              `<label class="field"><span>${t('buyPrice')} (€)</span><input class="inp" name="buyPrice" inputmode="decimal" value="${d.buyPrice ?? ''}"></label>
               <label class="field"><span>${t('buyDate')}</span><input class="inp" name="buyDate" type="date" value="${esc(d.buyDate || '')}"></label>`}
            <label class="field"><span>${t('priceSource')}</span><select class="inp" name="source">${['auto', ...SOURCES].map(s => `<option value="${s}" ${d.source === s ? 'selected' : ''}>${t('src_' + s)}</option>`).join('')}</select></label>
            <label class="field ${d.source === 'manual' ? '' : 'off'}"><span>${t('manualPrice')} (€)</span><input class="inp" name="manualPrice" inputmode="decimal" value="${d.manualPrice ?? ''}"></label>
            <label class="field wide"><span>${t('notes')}</span><input class="inp" name="notes" value="${esc(d.notes || '')}"></label>
          </div>
          <div class="m-actions">
            ${M.isNew ? `<button type="button" class="btn primary" data-act="m-add" data-list="collection">${icon('plus')} ${t('addToCollection')}</button>
                         <button type="button" class="btn" data-act="m-add" data-list="wishlist">${icon('heart')} ${t('addToWishlist')}</button>` :
              `<button type="button" class="btn primary" data-act="m-save">${t('save')}</button>
               ${wish ? `<button type="button" class="btn" data-act="m-move">${t('moveToCollection')}</button>` : ''}
               <button type="button" class="btn ghost danger" data-act="m-remove">${t('remove')}</button>`}
          </div>
        </form>
      </div>
    </div>
  </div>`;
  const ch = $('#itemChart');
  if (ch) drawChart(ch, d.history.map(([dd, vv]) => ({ d: dd, v: vv })), { height: 120 });
  setupTilt();
  if (still) $('#modal .overlay').scrollTop = keepScroll;
}

function ebayOutHtml(d, ebs) {
  const eb = d.ebay;
  if (!eb) return '';
  if (eb.loading) return `<div class="loading small"><span class="spinner"></span>${t('ebaySearching')}</div>`;
  if (eb.error) {
    const msg = { login: t('ebayLogin'), noext: t('ebayNoExt'), failed: t('ebayFailed') }[eb.error] || t('ebayFailed');
    return `<p class="note warn">${msg}</p>`;
  }
  if (!eb.results || !eb.results.length) return `<p class="muted small">${t('ebayNone')}</p>`;
  const used = new Set(ebs.usedIds);
  return `
    ${ebs.count ? `<div class="stats">
      <div class="stat strong"><span>${t('ebayMedian')}</span><b>${money(ebs.median)}</b></div>
      <div class="stat"><span>${t('ebayAvg')}</span><b>${money(ebs.avg)}</b></div>
      <div class="stat"><span>${t('ebayRange')}</span><b>${money(ebs.min)} – ${money(ebs.max)}</b></div>
      <div class="stat"><span>&nbsp;</span><b>${ebs.count} ${t('ebaySales')}</b></div></div>` : `<p class="muted small">${t('ebayNone')}</p>`}
    <p class="muted small">${t('ebayFilterHint')}</p>
    <div class="sold">${eb.results.slice(0, 40).map(r => `
      <div class="sale ${used.has(r.id) ? '' : 'ex'}" data-act="toggle-sale" data-id="${esc(r.id)}" title="${used.has(r.id) ? t('ebayExclude') : t('ebayInclude')}">
        ${r.img ? `<img loading="lazy" src="${esc(r.img)}" alt="">` : '<span class="noim"></span>'}
        <div class="sale-t">${esc(r.title)}</div>
        <div class="sale-d">${r.date ? fmtDate(r.date) : ''}</div>
        <div class="sale-p">${money(r.eur)}</div>
        ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="sale-l" data-stop>${icon('ext', 'sm')}</a>` : ''}
      </div>`).join('')}</div>`;
}

// Legge i venduti eBay e calcola le statistiche (kind: 'card' o 'sealed').
async function ebayLookup(query, d, kind, opts = {}) {
  const res = await EBAY.sold(S.settings.ebayDomain, query, kind === 'sealed' ? '2536' : '183454', opts);
  if (res.error) return { ...(d.ebay || {}), query, loading: false, error: res.error };
  const results = res.items.map(r => {
    const eur = toEur(r.price, r.currency || res.currency);
    return { ...r, eur: Math.round(eur * 100) / 100, auto: kind === 'sealed' ? EBAY.autoExcludedSealed(r, d) : EBAY.autoExcluded(r, d) };
  });
  const st = EBAY.stats(results, [], []);
  return { query, results, excluded: [], included: [], at: Date.now(), loading: false, error: null, median: st.median ?? null, count: st.count, fv: EBAY_FV };
}

async function runEbay(query, isCard) {
  const d = M.draft, kind = M.kind === 'sealed' ? 'sealed' : 'card';
  const custom = isCard ? query !== ebayQuery(d) : query !== sealedQuery(d);
  d.ebay = { ...(d.ebay || {}), query, custom, loading: true, error: null };
  $('#ebayOut').innerHTML = ebayOutHtml(d);
  const btn = $('#ebayBtn'); if (btn) btn.disabled = true;
  const eb = await ebayLookup(query, d, kind);
  if (!M || M.draft !== d) return;
  d.ebay = { ...eb, custom };
  persistEbayIfOwned(d);
  renderModal();
}

// Valore del sigillato dai venduti eBay, in background (uno alla volta).
let sealedBusy = false;
async function refreshSealedEbay(force = false, onlyUid = null) {
  if (!EBAY.isExt || sealedBusy) return;
  const maxAge = force ? 6 * 36e5 : PRICE_TTL;
  const todo = S.sealed.filter(p => (onlyUid ? p.uid === onlyUid : p.source === 'ebay') && (onlyUid || !p.ebay || !p.ebay.at || Date.now() - p.ebay.at > maxAge));
  if (!todo.length) return;
  sealedBusy = true;
  let loginAsked = false;
  for (const p of todo) {
    if (loginAsked) break;
    const eb = await ebayLookup(sealedQ(p), p, 'sealed', { silent: true });
    const cur = S.sealed.find(x => x.uid === p.uid); if (!cur) continue;
    if (eb.error) { if (eb.error === 'login') { loginAsked = true; toast(t('ebayLogin')); } continue; }
    cur.ebay = { ...eb, custom: sealedQ(p) !== sealedQuery(p) };
    const u = sealedUnit(cur);
    if (u != null) { cur.history = cur.history || []; const l = cur.history[cur.history.length - 1]; if (l && l[0] === today()) l[1] = u; else cur.history.push([today(), u]); }
    saveAuto();
    if (!M && ['sealed', 'dashboard'].includes(route().name)) render();
  }
  sealedBusy = false;
  snapshotPortfolio(); saveAuto();
}
// Carte salvate prima che l'app distinguesse "Unlimited": controlla una volta se esistono in 1ª edizione
async function fillHas1st() {
  const todo = S.items.filter(i => (!i.db || i.db === 'tcgdex') && i.has1st === undefined);
  if (!todo.length) return;
  for (const it of todo) {
    try { const c = await API.getCard(it.lang, it.cardId); it.has1st = !!c && API.slotsForCard(c, true).some(s => s.variant === 'firstEdition'); }
    catch { /* offline: riprova al prossimo avvio */ }
  }
  saveAuto();
  if (!M && ['collection', 'wishlist', 'dashboard'].includes(route().name)) render();
}

// Carte gradate: il valore viene dai venduti eBay con lo stesso ente e voto, aggiornato in background.
let gradedBusy = false;
async function refreshGradedEbay(force = false) {
  if (!EBAY.isExt || gradedBusy) return;
  const maxAge = force ? 6 * 36e5 : PRICE_TTL;
  const todo = collection().filter(i => i.grade && i.grade.co && (!i.source || i.source === 'auto' || i.source === 'ebay') &&
    (!i.ebay || !i.ebay.at || Date.now() - i.ebay.at > maxAge));
  if (!todo.length) return;
  gradedBusy = true;
  for (const it of todo) {
    const eb = await ebayLookup(ebayQ(it), it, 'card', { silent: true });
    const cur = S.items.find(x => x.uid === it.uid); if (!cur) continue;
    if (eb.error) { if (eb.error === 'login') toast(t('ebayLogin')); break; }
    cur.ebay = { ...eb, custom: ebayQ(it) !== ebayQuery(it) };
    saveAuto();
    if (!M && ['collection', 'dashboard'].includes(route().name)) render();
  }
  gradedBusy = false;
  snapshotPortfolio(); saveAuto();
}
function persistEbayIfOwned(d) {
  if (M && !M.isNew && d.uid) {
    const it = (M.kind === 'sealed' ? S.sealed : S.items).find(i => i.uid === d.uid);
    if (it) { it.ebay = JSON.parse(JSON.stringify({ ...d.ebay, loading: false })); snapshotPortfolio(); saveAuto(); }
  }
}

function readCopyForm() {
  const f = $('form[data-form="copy"]'); if (!f || !M) return;
  const d = M.draft, fd = new FormData(f);
  const oldKey = d.variant + '|' + (d.finish || '');
  const vsel = f.querySelector('[name="variant"]');
  if (vsel && vsel.value) {
    const [vv, ff] = vsel.value.split('|');
    d.variant = vv; d.finish = ff || null;
    d.finishLabel = ff ? vsel.selectedOptions[0].dataset.fl || null : null;
  }
  d.condition = fd.get('condition');
  d.grade = { co: fd.get('gco') || '', g: (fd.get('gg') || '').trim(), cert: (fd.get('gcert') || (d.grade && d.grade.cert) || '').trim(),
    black: fd.has('gblack') ? fd.get('gblack') === '1' : !!(d.grade && d.grade.black) };
  d.qty = Math.max(1, parseInt(fd.get('qty'), 10) || 1);
  if (fd.has('buyPrice')) d.buyPrice = num(fd.get('buyPrice'));
  if (fd.has('buyDate')) d.buyDate = fd.get('buyDate');
  if (fd.has('targetPrice')) d.targetPrice = num(fd.get('targetPrice'));
  d.source = fd.get('source');
  d.manualPrice = num(fd.get('manualPrice'));
  d.notes = fd.get('notes');
  if (fd.has('cname')) {
    d.name = (fd.get('cname') || '').trim(); d.localId = (fd.get('cnum') || '').trim(); d.lang = fd.get('clang') || d.lang;
    const ns = (fd.get('cset') || '').trim();
    if (ns !== d.setName) { d.setName = ns; if (d.db === 'custom') d.setId = 'custom-' + API.norm(ns); }
  }
  if (oldKey !== d.variant + '|' + (d.finish || '')) {
    if (M.card) { const pp = API.pricing(M.card, d.variant, d.finish); d.cm = pp.cm; d.tcgp = pp.tcg || null; }
    else if (d.db === 'cm' && CM.ready) d.cm = CM.priceOf(d.cmId, d.variant === 'reverse') || d.cm;
  }
}

function setupTilt() {
  const el = $('#modal [data-tilt]'); if (!el) return;
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', ((0.5 - y) * 14).toFixed(2) + 'deg');
    el.style.setProperty('--ry', ((x - 0.5) * 18).toFixed(2) + 'deg');
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    el.classList.add('active');
  });
  el.addEventListener('pointerleave', () => { el.classList.remove('active'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
}

// ---------- esportazione ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCsv() {
  const cols = ['list', 'name', 'setName', 'localId', 'official', 'lang', 'variant', 'condition', 'grade', 'qty', 'unitEUR', 'valueEUR', 'buyPrice', 'buyDate', 'cmTrend', 'cmAvg30', 'ebayMedian', 'notes', 'cardId'];
  const rows = S.items.map(i => [i.list, i.name, i.setName, classicNum(i) || i.localId, i.official, i.lang, variantLabel(i), i.condition, i.grade && i.grade.co ? i.grade.co + ' ' + i.grade.g : '', i.qty,
    unitValue(i)?.toFixed(2), itemValue(i)?.toFixed(2), i.buyPrice, i.buyDate, i.cm && i.cm.trend, i.cm && i.cm.avg30, i.ebay && i.ebay.median, i.notes, i.cardId]);
  S.sealed.forEach(p => { const u = sealedUnit(p); rows.push(['sealed', p.name, p.setName, '', '', p.lang, t('stype_' + p.type), '', '', p.qty,
    u?.toFixed(2), u != null ? (u * (p.qty || 1)).toFixed(2) : '', p.buyPrice, p.buyDate, '', '', p.ebay && p.ebay.median, p.notes, '']); });
  const csv = [cols, ...rows].map(r => r.map(x => { const s = x == null ? '' : String(x); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');
  download(`vetrina-${today()}.csv`, '﻿' + csv, 'text/csv');
}

// ---------- eventi ----------
document.addEventListener('click', async e => {
  const stop = e.target.closest('[data-stop]'); if (stop) return;
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'close-modal') { if (e.target === a || a.classList.contains('mclose')) closeModal(); return; }
  switch (act) {
    case 'ui-lang': S.settings.uiLang = a.dataset.v; save(); render(); break;
    case 'refresh': if (S.refreshing) break; toast(t('scan_start')); refreshPrices(true).then(() => toast(t('scan_done'))); refreshSealedEbay(true).then(() => refreshGradedEbay(true)); break;
    case 'view': S.settings.view = a.dataset.v; save(); render(); break;
    case 'more': S.search.shown += 60; render(); if (S.search.ver === 'rev') loadRevSlots(S.search); break;
    case 'setview': S.setView = a.dataset.v; render(); break;
    case 'quick-add': e.stopPropagation(); quickAdd(a.dataset.lang, a.dataset.id, a, slotFromEl(a)); break;
    case 'open-card': openCard(a.dataset.lang, a.dataset.id, null, slotFromEl(a)); break;
    case 'search-ver': {
      S.searchVer = a.dataset.v;
      if (S.search.q) doSearch(S.search.q.replace(REV_WORDS, ' ').replace(/\s+/g, ' ').trim() || S.search.q, S.search.lang || S.settings.cardLang); else render();
      break;
    }
    case 'open-item': { const it = S.items.find(i => i.uid === a.dataset.uid); if (it) { if (it.db && it.db !== 'tcgdex') openStored(it); else openCard(it.lang, it.cardId, it.uid); } break; }
    case 'open-cat': openCatalog(a.dataset.src, a.dataset.id); break;
    case 'quick-cat': {
      e.stopPropagation();
      const it = addItem(catalogDraft(a.dataset.src, a.dataset.id));
      snapshotPortfolio(); save(); toast(`${t('added')}: ${it.name}`); render(); break;
    }
    case 'custom-card': openCatalog('custom'); break;
    case 'open-mgroup': { const [l, ...rest] = a.dataset.k.split('|'); location.hash = `#/master/${l}/${encodeURIComponent(rest.join('|'))}`; break; }
    case 'c-photo-remove': readCopyForm(); M.draft.photo = ''; renderModal(); break;
    case 'cm-import-names':
      if (!EBAY.isExt) { toast(t(cmNoExtKey())); break; }
      chrome.tabs.create({ url: 'https://www.cardmarket.com/it/Pokemon/Products/Singles?vetrina=1', active: true });
      break;
    case 'cm-refresh':
      a.disabled = true; a.textContent = t('cm_loading');
      CM.load(true).then(ok => { toast(ok ? t('cm_updated') : t('offline')); render(); }); break;
    case 'm-add': {
      readCopyForm();
      if (!M.draft.name) { toast(t('custom_needName')); $('[name="cname"]')?.focus(); break; }
      const d = { ...M.draft, list: a.dataset.list };
      if (d.ebay) d.ebay = { ...d.ebay, loading: false };
      const it = addItem(d);
      snapshotPortfolio(); save();
      toast(`${a.dataset.list === 'wishlist' ? t('addedWish') : t('added')}: ${it.name}`);
      closeModal(); render(); break;
    }
    case 'm-save': {
      readCopyForm();
      const i = S.items.findIndex(x => x.uid === M.draft.uid);
      if (i >= 0) { const d = M.draft; const u = unitValue(d); if (u != null) { d.history = d.history || []; const l = d.history[d.history.length - 1]; if (l && l[0] === today()) l[1] = u; else d.history.push([today(), u]); } S.items[i] = d; }
      snapshotPortfolio(); save(); toast(t('saved')); closeModal(); render(); break;
    }
    case 'm-move': {
      readCopyForm();
      const i = S.items.findIndex(x => x.uid === M.draft.uid);
      if (i >= 0) { S.items.splice(i, 1); addItem({ ...M.draft, list: 'collection', buyDate: today() }); }
      snapshotPortfolio(); save(); toast(t('added')); closeModal(); render(); break;
    }
    case 'm-remove':
      if (confirm(t('confirmRemove'))) { S.items = S.items.filter(x => x.uid !== M.draft.uid); snapshotPortfolio(); save(); toast(t('removed')); closeModal(); render(); }
      break;
    case 'toggle-sale': {
      const d = M.draft, id = a.dataset.id, eb = d.ebay;
      const ebs = EBAY.stats(eb.results, eb.excluded, eb.included);
      const isUsed = ebs.usedIds.includes(id);
      eb.excluded = eb.excluded.filter(x => x !== id); eb.included = eb.included.filter(x => x !== id);
      if (isUsed) eb.excluded.push(id); else eb.included.push(id);
      const st = EBAY.stats(eb.results, eb.excluded, eb.included);
      eb.median = st.median ?? null; eb.count = st.count;
      persistEbayIfOwned(d);
      renderModal(); break;
    }
    // --- master set ---
    case 'master-pick': S.masterPick = !S.masterPick; S.sets.filter = ''; render(); break;
    case 'master-filter': S.masterFilter = a.dataset.v; render(); break;
    case 'slot': {
      const s = MS && MS.slots[+a.dataset.i]; if (!s) break;
      if (s.owners.length) { openCard(s.owners[0].lang, s.owners[0].cardId, s.owners[0].uid); break; }
      const it = addItem(slotDraft(s));
      snapshotPortfolio(); save();
      toast(`${t('added')}: ${it.name} · ${variantLabel(it)} · NM`);
      const y = window.scrollY; render(); window.scrollTo(0, y); break;
    }
    case 'master-fill': {
      const miss = MS ? MS.slots.filter(s => !s.owners.length) : [];
      if (!miss.length || !confirm(t('master_confirmAdd').replace('{n}', miss.length))) break;
      miss.forEach(s => addItem(slotDraft(s)));
      snapshotPortfolio(); save();
      toast(t('master_addedN').replace('{n}', miss.length));
      render(); break;
    }
    case 'master-remove': {
      if (!MS || !confirm(t('master_confirmRemove'))) break;
      S.masters = S.masters.filter(m => !(m.lang === MS.lang && m.setId === MS.setId));
      save(); go('master'); break;
    }
    // --- sealed ---
    case 'sealed-new': openSealed(); break;
    case 'open-sealed': openSealed(a.dataset.uid); break;
    case 's-cm-pick': {
      readSealedForm();
      const c = (M.cmRes || []).find(x => String(x.idProduct) === a.dataset.id);
      const d = M.draft;
      d.cmId = +a.dataset.id; d.cmName = c ? c.name : ''; d.cm = CM.priceOf(d.cmId, false); d.source = 'cm';
      M.cmRes = null; renderSealedModal(); break;
    }
    case 's-cm-unlink': readSealedForm(); Object.assign(M.draft, { cmId: null, cmName: '', cm: null }); if (M.draft.source === 'cm') M.draft.source = 'ebay'; renderSealedModal(); break;
    case 's-photo-remove': readSealedForm(); M.draft.photo = ''; M.draft.webPhoto = ''; M.draft.webPick = true; M.draft.webKey = sealedWebKey(M.draft); renderSealedModal(); break;
    case 's-webpics': {
      readSealedForm(); M.webPics = 'loading'; renderSealedModal();
      const d = M.draft, en = M.enSets && d.setId ? M.enSets.get(d.setId) : null;
      WEBIMG.productCandidates({ lang: d.lang, type: d.type, name: d.setName || d.name, enName: en && en.name, setId: d.setId })
        .then(l => { if (M && M.kind === 'sealed' && M.draft === d) { M.webPics = l.slice(0, 12); renderSealedModal(); } });
      break;
    }
    case 's-webpick': readSealedForm(); M.draft.photo = ''; M.draft.webPhoto = a.dataset.u; M.draft.webPick = true; M.draft.webKey = sealedWebKey(M.draft); M.webPics = null; renderSealedModal(); break;
    case 's-add': case 's-save': {
      readSealedForm();
      const d = { ...M.draft };
      if (d.ebay) d.ebay = { ...d.ebay, loading: false };
      if (act === 's-add') { d.uid = uid(); d.addedAt = Date.now(); S.sealed.push(d); toast(`${t('added')}: ${d.name}`); }
      else { const i = S.sealed.findIndex(p => p.uid === d.uid); if (i >= 0) S.sealed[i] = d; toast(t('saved')); }
      snapshotPortfolio(); save(); closeModal(); render();
      // valore dai venduti eBay: se non è ancora stato cercato, lo cerca subito in background
      if (d.source === 'ebay' && !(d.ebay && d.ebay.results)) refreshSealedEbay(false, d.uid);
      break;
    }
    case 's-remove':
      if (confirm(t('confirmRemove'))) { S.sealed = S.sealed.filter(p => p.uid !== M.draft.uid); snapshotPortfolio(); save(); toast(t('removed')); closeModal(); render(); }
      break;
    case 'export-json': download(`vetrina-backup-${today()}.json`, JSON.stringify({ app: 'vetrina-tcg', v: 2, settings: S.settings, items: S.items, masters: S.masters, sealed: S.sealed, portfolio: S.portfolio }, null, 1), 'application/json'); break;
    case 'import-json': $('#importFile').click(); break;
    case 'export-csv': exportCsv(); break;
    case 'drive-sync': driveConnectAndSync(); break;
    case 'drive-logout': if (confirm(t('drive_logoutConfirm'))) { DRIVE.logout(); render(); } break;
    case 'clear-all': if (confirm(t('confirmClear'))) { S.items = []; S.masters = []; S.sealed = []; S.portfolio = []; save(); render(); } break;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && M) closeModal();
  if (e.key === 'Enter' && e.target.matches('.tile.res, .tile.slot')) e.target.click();
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  if (f.dataset.form === 'gsearch' && isMobile()) { const n = f.querySelector('input'); n && n.blur(); return; }
  if (f.dataset.form === 'gsearch') { const q = (fd.get('q') || '').trim(); if (q) doSearch(q, S.search.lang || S.settings.cardLang); }
  if (f.dataset.form === 'search') { const q = (fd.get('q') || '').trim(); if (q) doSearch(q, fd.get('lang')); }
  if (f.dataset.form === 'ebay') {
    if (M.kind === 'sealed') { readSealedForm(); runEbay((fd.get('q') || '').trim() || sealedQuery(M.draft)); }
    else { readCopyForm(); runEbay((fd.get('q') || '').trim() || ebayQuery(M.draft), true); }
  }
  // master set: apre la ricerca eBay (annunci in vendita) e ricorda il testo se l'hai cambiato
  if (f.dataset.form === 'ms-link' && MS) {
    const m = findMaster(MS.lang, MS.setId);
    if (m) {
      const q = (fd.get('q') || '').trim(); m.estQuery = q && q !== masterQueryAuto(m) ? q : null; save();
      window.open(EBAY.url(S.settings.ebayDomain, masterQuery(m), '2536', true), '_blank', 'noopener');
    }
  }
  // master set: valore scritto a mano (da quello che vedi su eBay)
  if (f.dataset.form === 'ms-value' && MS) {
    const m = findMaster(MS.lang, MS.setId);
    if (m) {
      // accetta "420", "420,50", "1.250,00", "€ 420"
      let raw = String(fd.get('v') || '').replace(/[^\d.,]/g, '');
      if (/,\d{1,2}$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.'); else raw = raw.replace(/,/g, '');
      const v = parseFloat(raw);
      m.value = v > 0 ? Math.round(v * 100) / 100 : null; m.valueAt = m.value ? Date.now() : null;
      if (m.stats) { m.stats.est = m.value; m.stats.value = m.value; }
      save(); toast(t('saved')); render();
    }
  }
  if (f.dataset.form === 'sealed') { readSealedForm(); renderSealedModal(); }
  if (f.dataset.form === 'cmsealed') { readSealedForm(); runCmSealed((fd.get('q') || '').trim() || cmSealedQuery(M.draft)); }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.set) {
    S.settings[el.dataset.set] = el.dataset.set === 'gClientId' ? el.value.trim() : el.value; save();
    if (el.dataset.set === 'gClientId') DRIVE.preload();
    if (el.dataset.set === 'cardLang') { S.search.lang = null; S.sets.lang = null; }
    render(); return;
  }
  if (el.dataset.cf !== undefined && el.tagName === 'SELECT') { S.colFilter[el.dataset.cf] = el.value; render(); return; }
  if (el.dataset.actChange === 'sets-lang') { S.sets.lang = el.value; render(); return; }
  if (el.dataset.actChange === 'master-special') {
    const m = MS && findMaster(MS.lang, MS.setId); if (m) { m.special = el.checked; save(); render(); } return;
  }
  if (el.closest('form[data-form="copy"]')) {
    readCopyForm(); renderModal(); return;
  }
  if (el.closest('form[data-form="sealed"]')) {
    const r = readSealedForm();
    if (r && r.langChanged) { M.sets = []; renderSealedModal(); loadSealedSets(); } else renderSealedModal();
    return;
  }
  if (el.id === 'cardPhoto' && el.files[0]) {
    readCopyForm();
    try { M.draft.photo = await resizePhoto(el.files[0]); } catch { /* immagine non leggibile */ }
    renderModal(); return;
  }
  if (el.id === 'sealedPhoto' && el.files[0]) {
    readSealedForm();
    try { M.draft.photo = await resizePhoto(el.files[0]); } catch { /* immagine non leggibile */ }
    renderSealedModal(); return;
  }
  if (el.id === 'importFile' && el.files[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (!Array.isArray(data.items)) throw new Error('bad');
      S.items = fixImgs(data.items); S.portfolio = data.portfolio || []; Object.assign(S.settings, data.settings || {});
      S.masters = data.masters || []; S.sealed = data.sealed || [];
      save(); toast(t('imported')); render();
    } catch { alert('File non valido'); }
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.cf === 'q') {
    S.colFilter.q = el.value;
    const pos = el.selectionStart;
    if (route().name !== 'collection') history.replaceState(null, '', '#/collection');
    else S.noAnim = true;
    render();
    const n = $('[data-cf="q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  }
  if (el.dataset.sf !== undefined) { S.sets.filter = el.value; renderSetGrid(); }
});

// immagine non caricata: mostra il segnaposto
document.addEventListener('error', e => {
  const el = e.target;
  if (el.tagName !== 'IMG') return;
  el.classList.add('broken'); const p = el.closest('.tile-img, .mini-img, .holo'); if (p) p.classList.add('ph');
  // immagine salvata che non funziona più (es. dati arrivati da un altro dispositivo): prova quella di ripiego
  if (el.dataset.card && !el.dataset.retried) {
    el.dataset.retried = '1';
    const [lang, setId, localId] = el.dataset.card.split('|');
    API.fallbackImage(lang, setId, localId).then(base => {
      const u = base && img(base);
      if (u && u !== el.src) { el.classList.remove('broken'); if (p) p.classList.remove('ph'); el.src = u; }
    }).catch(() => {});
  }
}, true);

// quando torni sulla scheda dell'app, l'estensione controlla subito se c'è una versione nuova nella cartella
if (EBAY.isExt) document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !M) chrome.runtime.sendMessage({ type: 'vetrina-check-update' }).catch(() => {});
});

matchMedia('(max-width: 760px)').addEventListener('change', () => render());
window.addEventListener('hashchange', () => { if (M) closeModal(); render(); window.scrollTo(0, 0); });
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (route().name === 'dashboard' && !M) render(); }, 200); });

// nomi delle espansioni letti dalla pagina di Cardmarket (vedi content-cardmarket.js)
if (EBAY.isExt) chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'vetrina-cm-expansions') return;
  const n = Object.keys(msg.map || {}).length;
  if (!n) { toast(t('cm_namesFail')); return; }
  CM.setExpNames(msg.map).then(() => {
    S.items.filter(i => i.db === 'cm').forEach(i => { const id = String(i.setId).replace('cm-exp-', ''); if (msg.map[id]) i.setName = msg.map[id]; });
    if (S.search.cm) S.search.cm.forEach(c => { if (msg.map[c.idExpansion]) c.expansion = msg.map[c.idExpansion]; });
    saveAuto(); toast(t('cm_namesOk').replace('{n}', n));
    if (sender.tab) chrome.tabs.remove(sender.tab.id).catch(() => {});
    if (!M) render();
  });
});

// ---------- avvio ----------
(async function start() {
  await load();
  // Google Drive: prima di tutto prende la copia più recente (se l'accesso è ancora valido)
  DRIVE.init({ clientId: () => S.settings.gClientId, getState: syncState, applyState: applySyncState, getUpdatedAt: () => S.editedAt || 0,
    isEmpty: () => !S.items.length && !S.masters.length && !S.sealed.length, conflict: driveConflict });
  DRIVE.onUpdate(renderDriveState);
  // versione web su https (GitHub Pages): file dell'app disponibili anche offline
  if (!EBAY.isExt && location.protocol === 'https:' && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (DRIVE.connected() && DRIVE.everSynced()) await DRIVE.sync();
  renderDriveBar();
  // quando torni sull'app (es. riaperta sul telefono senza ricaricarla) prende subito le modifiche fatte altrove
  let lastPull = Date.now();
  const pullDrive = () => {
    if (document.visibilityState !== 'visible' || !DRIVE.everSynced() || Date.now() - lastPull < 15000) return;
    lastPull = Date.now();
    if (DRIVE.connected()) DRIVE.sync(); else { DRIVE.status.state = 'needLogin'; renderDriveState(); }
  };
  document.addEventListener('visibilitychange', pullDrive);
  window.addEventListener('focus', pullDrive);
  S.rates = await API.getRates().catch(() => S.rates);
  render();
  // prezzi: niente aggiornamenti automatici, solo con il pulsante «Scansiona prezzi»
  fillHas1st();
})();
