// Salvataggio locale (IndexedDB) e accesso alle fonti esterne (TCGdex, cambi valuta, eBay).
const DB = (() => {
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('vetrina-tcg', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function get(key) {
    const db = await open();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  async function set(key, val) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
  return { get, set };
})();

const API = (() => {
  const BASE = 'https://api.tcgdex.net/v2';
  const mem = new Map();
  const DAY = 864e5;

  async function json(url) {
    if (mem.has(url)) return mem.get(url);
    const p = fetch(url).then(r => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    mem.set(url, p);
    try { return await p; } catch (e) { mem.delete(url); throw e; }
  }

  // Pokémon TCG Pocket (gioco digitale): escluso da ricerca, espansioni e master set.
  // Set A1, A1a… B2a e promo P-A; si aggiorna con la serie "tcgp" di TCGdex quando escono set nuovi.
  const POCKET_RE = /^(A\d+[a-z]?|B\d+[a-z]?|P-[AB])$/;
  let pocketIds = new Set();
  const isPocket = setId => POCKET_RE.test(setId) || pocketIds.has(setId);
  async function loadPocket() {
    const c = await DB.get('pocket_sets');
    if (c && Date.now() - c.at < 7 * DAY) { pocketIds = new Set(c.ids); return; }
    try {
      const s = await json(`${BASE}/en/series/tcgp`);
      const ids = (s && s.sets || []).map(x => x.id);
      pocketIds = new Set(ids); await DB.set('pocket_sets', { at: Date.now(), ids });
    } catch { /* basta l'elenco fisso */ }
  }
  const pocketReady = loadPocket().catch(() => {});

  async function getSets(lang) {
    await pocketReady;
    const key = 'sets_' + lang;
    const cached = await DB.get(key);
    let list;
    if (cached && Date.now() - cached.at < DAY) list = cached.list;
    else {
      list = (await json(`${BASE}/${lang}/sets`)) || [];
      list.forEach((s, i) => (s.order = i));
      await DB.set(key, { at: Date.now(), list });
    }
    return list.filter(s => !isPocket(s.id));
  }

  async function setsMap(lang) {
    const m = new Map();
    (await getSets(lang)).forEach(s => m.set(s.id, s));
    return m;
  }

  function setIdOf(card) {
    const suf = '-' + card.localId;
    return card.id.endsWith(suf) ? card.id.slice(0, -suf.length) : card.id.split('-').slice(0, -1).join('-');
  }

  async function searchCards(lang, query) {
    query = query.trim();
    let name = query, num = null;
    const m = query.match(/^(.*?\S)\s+#?([A-Za-z]{0,4}\d+[a-z]?)(?:\s*\/\s*[A-Za-z]{0,4}\d+)?\s*$/);
    if (m) { name = m[1]; num = m[2]; }
    else if (/^#?\d+(\/\d+)?$/.test(query)) { name = ''; num = query.replace('#', '').split('/')[0]; }
    if (!name) return [];
    let list = await decorate(lang, `${BASE}/${lang}/cards?name=${encodeURIComponent(name)}`);
    if (num) {
      const norm = x => String(x).replace(/^0+/, '').toLowerCase();
      list = list.filter(c => norm(c.localId) === norm(num));
    }
    list.sort((a, b) => b.order - a.order || String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }));
    return list;
  }

  // Database locale delle immagini che TCGdex non ha (images.js): Limitless TCG e Scrydex
  function extImage(lang, id) {
    const m = typeof CARD_IMAGES !== 'undefined' && CARD_IMAGES[lang];
    return m && m[id] ? 'ext:' + m[id] : null;
  }
  function extUrl(k, q) {
    const big = q === 'high';
    if (k.startsWith('l:')) return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/${k.slice(2)}_R_JP${big ? '_LG' : ''}.png`;
    if (k.startsWith('s:')) return `https://images.scrydex.com/pokemon/${k.slice(2)}/${big ? 'large' : 'medium'}`;
    // TCGplayer: immagine del prodotto (codice prodotto da TCGdex), sempre la carta giusta
    if (k.startsWith('t:')) return `https://tcgplayer-cdn.tcgplayer.com/product/${k.slice(2)}_in_${big ? '1000x1000' : '400x400'}.jpg`;
    return '';
  }
  // codice prodotto TCGplayer della carta (da TCGdex)
  function tcgProductId(c) {
    if (!c) return null;
    for (const vd of c.variants_detailed || []) if (vd.thirdParty && vd.thirdParty.tcgplayer) return vd.thirdParty.tcgplayer;
    const tp = c.pricing && c.pricing.tcgplayer;
    if (tp) for (const k in tp) if (tp[k] && tp[k].productId) return tp[k].productId;
    return null;
  }
  // carta senza immagine TCGdex: prima le scansioni giapponesi (Limitless), poi TCGplayer, poi Scrydex
  // (Scrydex per alcune carte, es. Classic Collection del 30°, mostra solo il retro)
  const withImg = (lang, c) => {
    if (c && !c.image) {
      const e = extImage(lang, c.id), pid = tcgProductId(c);
      c.image = e && e.startsWith('ext:l:') ? e : pid ? 'ext:t:' + pid : e || c.image;
    }
    return c;
  };

  async function decorate(lang, url) {
    const [cards, sets] = await Promise.all([json(url), setsMap(lang)]);
    return (cards || []).filter(c => !isPocket(setIdOf(c))).map(c => {
      const setId = setIdOf(c);
      const s = sets.get(setId);
      // (Scrydex no: senza dettagli della carta non si sa se c'è l'immagine TCGplayer, la cerca il ripiego)
      const e = extImage(lang, c.id);
      return { ...c, image: c.image || (e && !e.startsWith('ext:s:') ? e : null), lang, setId, setName: s ? s.name : setId, official: s && s.cardCount ? s.cardCount.official : null, order: s ? s.order : -1 };
    });
  }
  // Tutte le carte di un Pokémon (numero del Pokédex) in una lingua, qualunque sia il nome stampato
  const searchDex = (lang, dexId) => decorate(lang, `${BASE}/${lang}/cards?dexId=eq:${dexId}`);

  const getCard = (lang, id) => json(`${BASE}/${lang}/cards/${encodeURIComponent(id)}`).then(c => withImg(lang, c));
  const getSet = (lang, id) => json(`${BASE}/${lang}/sets/${encodeURIComponent(id)}`).then(s => { if (s && s.cards) s.cards.forEach(c => withImg(lang, c)); return s; });

  // Immagine mancante nella lingua scelta: database locale, poi quella inglese (stesso id), poi nessuna.
  const serieCache = new Map();
  async function fallbackImage(lang, setId, localId) {
    const id = `${setId}-${localId}`;
    const own = extImage(lang, id), enExt = extImage('en', id);
    if (own && own.startsWith('ext:l:')) return own;
    for (const l of [...new Set([lang, 'en'])]) {
      try { const pid = tcgProductId(await getCard(l, id)); if (pid) return 'ext:t:' + pid; } catch { /* niente */ }
    }
    if (own) return own;
    if (enExt) return enExt;
    for (const l of ['en', lang]) {
      const k = l + '|' + setId;
      if (!serieCache.has(k)) serieCache.set(k, getSet(l, setId).then(s => s && s.serie ? s.serie.id : null).catch(() => null));
      const serie = await serieCache.get(k);
      if (serie && l === 'en') return `https://assets.tcgdex.net/en/${serie}/${setId}/${localId}`;
    }
    return null;
  }

  // "Poké Ball" → "pokeball", "Logo set" → "logoset"
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normType = s => { const n = norm(s); return /^rev/.test(n) ? 'reverse' : /^(holo|olo|holo)/.test(n) || n === 'olografica' ? 'holo' : /1st|first|prima/.test(n) ? 'firstEdition' : 'normal'; };
  // Set Base inglese: "shadowless" (senza ombra a destra del riquadro, prime tirature) e ristampa 1999-2000
  function finishOf(vd) {
    const sub = norm(vd.subtype);
    if (sub === 'shadowless') return [].concat(vd.stamp || []).some(s => /1st/i.test(s)) ? 'shadowless1st' : 'shadowless';
    if (sub === '19992000copyright') return 'print1999';
    if (vd.foil) return norm(vd.foil);
    if (vd.stamp) return 'stamp' + norm([].concat(vd.stamp).join(''));
    return null;
  }

  // Tutte le versioni collezionabili di una carta (per il master set).
  // Standard: normale / reverse / holo / 1ª ed. + reverse a motivo Poké Ball e Master Ball.
  // Speciali: timbri, reverse Cosmo e simili (da confezioni promozionali).
  function slotsForCard(card, includeSpecial) {
    const out = [];
    const v = card.variants || {};
    const vds = card.variants_detailed || [];
    // con le versioni shadowless la 1ª edizione è "1ª edizione shadowless": niente doppione generico
    const has1stShadowless = vds.some(vd => finishOf(vd) === 'shadowless1st');
    ['normal', 'holo', 'reverse', 'firstEdition'].forEach(k => { if (v[k] && !(k === 'firstEdition' && has1stShadowless)) out.push({ variant: k, finish: null, special: false }); });
    const FIRST_STAMP = /1st|first|1a\s*ed|1ª|erste|1re|prima/i;
    vds.forEach(vd => {
      // "timbro 1ª edizione" (non shadowless) = semplicemente la 1ª edizione: un'unica versione
      if (norm(vd.subtype) !== 'shadowless' && [].concat(vd.stamp || []).some(s => FIRST_STAMP.test(s))) {
        if (!has1stShadowless && !out.some(s => s.variant === 'firstEdition')) out.push({ variant: 'firstEdition', finish: null, special: false });
        return;
      }
      const f = finishOf(vd);
      if (!f) return;
      const special = !/ball$|^shadowless|^print1999$/.test(f);
      if (special && !includeSpecial) return;
      // timbro presente su tutte le copie di quel tipo (es. "30th anniversary" sulla Classic Collection):
      // è la carta stessa, non una versione in più
      if (vd.stamp && !vd.foil && out.some(s => s.variant === normType(vd.type) && !s.finish) && !vds.some(x => x !== vd && normType(x.type) === normType(vd.type) && !finishOf(x))) return;
      const label = { shadowless: 'Shadowless', shadowless1st: 'Shadowless', print1999: '1999-2000' }[f] ||
        (vd.foil ? [].concat(vd.foil).join(' ') : [].concat(vd.stamp).join(' '));
      const variant = f === 'shadowless1st' ? 'firstEdition' : normType(vd.type);
      if (!out.some(s => s.finish === f)) out.push({ variant, finish: f, finishLabel: label, special });
    });
    // Reverse solo a motivo (es. 151 giapponese: Poké Ball e Master Ball, nessuna reverse "semplice"):
    // la reverse generica non esiste, e il suo prezzo sarebbe quello di un'altra versione.
    const plainRev = vds.some(vd => normType(vd.type) === 'reverse' && !finishOf(vd));
    const ballRev = vds.some(vd => normType(vd.type) === 'reverse' && /ball$/.test(finishOf(vd) || ''));
    if (ballRev && !plainRev && vds.some(vd => normType(vd.type) !== 'reverse')) {
      const i = out.findIndex(s => s.variant === 'reverse' && !s.finish);
      if (i >= 0) out.splice(i, 1);
    }
    if (!out.length) out.push({ variant: 'normal', finish: null, special: false });
    // carta con 1ª edizione: le altre versioni sono "Unlimited"
    if (out.some(s => s.variant === 'firstEdition')) out.forEach(s => { s.has1st = true; });
    return out;
  }

  // Estrae i prezzi Cardmarket (EUR) giusti per la variante (e il motivo, se c'è).
  function pricing(card, variant, finish) {
    let p = card && card.pricing;
    const out = { cm: null };
    if (finish && card && card.variants_detailed) {
      const vd = card.variants_detailed.find(x => finishOf(x) === finish);
      if (vd && vd.pricing) p = vd.pricing;
      // carta timbrata senza prezzi suoi: su Cardmarket è catalogata come reverse holo della carta base
      else if (/^stamp/.test(finish)) variant = 'reverse';
    }
    if (!p) return out;
    // TCGplayer (USD, mercato USA): solo come ultima stima quando mancano eBay e Cardmarket
    const tp = p.tcgplayer;
    if (tp) {
      const keys = Object.keys(tp).filter(k => tp[k] && typeof tp[k] === 'object');
      const want = { normal: ['normal', 'unlimited', 'unlimitednormal'], holo: ['holofoil', 'unlimitedholofoil', 'holo'],
        reverse: ['reverseholofoil', 'reverse'], firstEdition: ['1steditionholofoil', '1stedition', '1steditionnormal'] }[variant] || [];
      const k = keys.find(x => want.includes(norm(x))) || (keys.length === 1 ? keys[0] : null);
      const o = k && tp[k];
      const v = o && (o.marketPrice || o.midPrice || o.lowPrice);
      if (v > 0) out.tcg = v;
    }
    const cm = p.cardmarket;
    if (cm) {
      const holo = (variant === 'reverse' && cm['trend-holo'] > 0) || (!(cm.trend > 0) && cm['trend-holo'] > 0);
      const f = k => { const v = cm[holo ? k + '-holo' : k]; return v > 0 ? v : null; };
      out.cm = { trend: f('trend'), avg30: f('avg30'), avg7: f('avg7'), avg1: f('avg1'), low: f('low'), avg: f('avg'), idProduct: cm.idProduct, updated: cm.updated, holo };
    }
    return out;
  }

  async function getRates() {
    const cached = await DB.get('rates');
    if (cached && Date.now() - cached.at < DAY / 2) return cached.rates;
    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,JPY,GBP').then(r => r.json());
      const rates = { EUR: 1, ...r.rates, date: r.date };
      await DB.set('rates', { at: Date.now(), rates });
      return rates;
    } catch {
      return (cached && cached.rates) || { EUR: 1, USD: 1.1, JPY: 170, GBP: 0.84 };
    }
  }

  // Espansione completa con il dettaglio di ogni carta (varianti e prezzi).
  async function getSetFull(lang, setId, onProgress) {
    const set = await getSet(lang, setId);
    if (!set) return null;
    const list = set.cards || [];
    const cards = new Array(list.length);
    let i = 0, done = 0;
    async function worker() {
      while (i < list.length) {
        const k = i++;
        try { cards[k] = await getCard(lang, list[k].id); } catch { cards[k] = null; }
        if (!cards[k]) cards[k] = { ...list[k], variants: { normal: true } };
        onProgress && onProgress(++done, list.length);
      }
    }
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    return { set, cards };
  }

  // versioni reverse holo e timbrate di una carta (ricerca «Reverse holo e timbrate»)
  function revSlots(card) {
    return slotsForCard(card, true).filter(s => s.variant === 'reverse' || /^stamp/.test(s.finish || ''));
  }

  return { isPocket, extImage, extUrl, getSets, setsMap, revSlots, searchCards, searchDex, getCard, getSet, getSetFull, fallbackImage, pricing, slotsForCard, getRates, setIdOf, norm };
})();

// ---------- Catalogo ufficiale Cardmarket ----------
// File pubblici di Cardmarket (tutte le carte e i prodotti sigillati Pokémon + guida prezzi giornaliera).
// Il server non permette la lettura da una pagina normale: funziona solo con l'app aperta come estensione.
const CM = (() => {
  // (vetrinaCmBase in localStorage serve solo per le prove in locale)
  let testBase = null; try { testBase = localStorage.getItem('vetrinaCmBase'); } catch { /* niente */ }
  const BASE = testBase || 'https://downloads.s3.cardmarket.com/productCatalog/';
  const canLoad = !!((typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || testBase);
  let cat = null, prices = null, loading = null, expNames = {};
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // nome dell'espansione ricavato dai prodotti sigillati ("Phantom Forces Booster" → "Phantom Forces")
  const SUFFIX = /\s+(pok[eé]mon center\s+)?(booster display box|booster display|booster box case|booster box|display|booster bundle|sleeved booster|booster pack|booster|elite trainer box|theme deck.*|build & battle.*|blister.*|3-pack.*|tin.*|collection.*|box set.*|premium.*|trainer kit.*)$/i;
  function deriveExpNames(sealed) {
    const best = {};
    sealed.forEach(([id, name, exp, c]) => {
      const base = name.replace(SUFFIX, '').trim();
      if (!base || base === name) return;
      const score = c === 52 ? 0 : c === 53 ? 1 : 2;
      if (!best[exp] || score < best[exp].score || (score === best[exp].score && base.length < best[exp].name.length)) best[exp] = { name: base, score };
    });
    const out = {}; Object.keys(best).forEach(k => (out[k] = best[k].name));
    return out;
  }

  async function fetchJson(file) {
    const r = await fetch(BASE + file, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function load(force = false) {
    if (!canLoad) return false;
    if (loading) return loading;
    loading = (async () => {
      try {
        expNames = (await DB.get('cm_expnames')) || {};
        let c = await DB.get('cm_catalog');
        if (force || !c || Date.now() - c.at > 7 * 864e5) {
          const [s, n] = await Promise.all([fetchJson('productList/products_singles_6.json'), fetchJson('productList/products_nonsingles_6.json')]);
          c = {
            at: Date.now(),
            singles: s.products.map(p => [p.idProduct, p.name, p.idExpansion]),
            sealed: n.products.map(p => [p.idProduct, p.name, p.idExpansion, p.idCategory])
          };
          c.derived = deriveExpNames(c.sealed);
          await DB.set('cm_catalog', c);
        }
        let pg = await DB.get('cm_prices');
        if (force || !pg || Date.now() - pg.at > 864e5 / 2) {
          const g = await fetchJson('priceGuide/price_guide_6.json');
          const map = {};
          g.priceGuides.forEach(x => {
            map[x.idProduct] = [x.trend, x.avg30, x.avg7, x.avg1, x.low, x.avg, x['trend-holo'], x['avg30-holo'], x['avg7-holo'], x['avg1-holo'], x['low-holo'], x['avg-holo']];
          });
          pg = { at: Date.now(), created: g.createdAt, map };
          await DB.set('cm_prices', pg);
        }
        cat = c; prices = pg;
        cat.idx = cat.singles.map(p => norm(p[1]));
        cat.sidx = cat.sealed.map(p => norm(p[1]));
        return true;
      } catch (e) { console.warn('Catalogo Cardmarket non disponibile', e); return false; }
      finally { loading = null; }
    })();
    return loading;
  }

  // espansioni senza prodotti sigillati (quindi senza nome ricavabile) riconosciute a mano
  const KNOWN = { 4170: 'Japanese Promos (1996–2001)' };
  const expName = id => expNames[id] || (cat && cat.derived && cat.derived[id]) || KNOWN[id] || null;
  const isPromoExp = id => /promo/i.test(expName(id) || '');

  function search(q, kind = 'singles', limit = 120) {
    if (!cat) return [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const list = kind === 'sealed' ? cat.sealed : cat.singles, idx = kind === 'sealed' ? cat.sidx : cat.idx;
    const out = [];
    for (let i = 0; i < list.length && out.length < limit; i++) {
      const s = idx[i];
      if (words.every(w => s.includes(w))) out.push(list[i]);
    }
    return out.map(([id, name, exp, c]) => ({ idProduct: id, name, idExpansion: exp, expansion: expName(exp), category: c }));
  }

  function priceOf(idProduct, holo) {
    const a = prices && prices.map[idProduct];
    if (!a) return null;
    const useHolo = (holo && a[6] > 0) || (!(a[0] > 0) && a[6] > 0);
    const f = i => { const v = a[useHolo ? i + 6 : i]; return v > 0 ? v : null; };
    return { trend: f(0), avg30: f(1), avg7: f(2), avg1: f(3), low: f(4), avg: f(5), idProduct, updated: prices.created, holo: useHolo };
  }

  // ---- immagini dei prodotti ----
  // 1) database locale cm-images.js (prodotto Cardmarket → carta TCGdex o immagine di images.js)
  // 2) immagini lette dalla pagina del prodotto su Cardmarket (aperta nel tuo Chrome), salvate in cm_imgs
  let pageImgs = null;
  DB.get('cm_imgs').then(v => { pageImgs = v || {}; }).catch(() => { pageImgs = {}; });
  function imageOf(id) {
    const k = String(id);
    const loc = typeof CM_IMAGES !== 'undefined' && CM_IMAGES[k];
    if (loc) return { image: loc.startsWith('ext:') ? loc : 'https://assets.tcgdex.net/' + loc };
    if (pageImgs && pageImgs[k]) return { imgUrl: pageImgs[k] };
    return null;
  }
  const isExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.tabs;
  const pending = new Map();
  // Apre la pagina del prodotto in una scheda in background e ne legge l'immagine (content-cm-image.js).
  // Se Cardmarket chiede la verifica di sicurezza, la scheda viene portata in primo piano per completarla.
  function fetchImage(id) {
    const k = String(id);
    if (!isExt) return Promise.resolve(null);
    if (pending.has(k)) return pending.get(k);
    const p = new Promise(resolve => {
      chrome.tabs.create({ url: `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${k}`, active: false }, tab => {
        const tid = tab.id; let done = false;
        const finish = async url => {
          if (done) return; done = true;
          clearTimeout(timer); clearTimeout(front); chrome.runtime.onMessage.removeListener(onMsg);
          chrome.tabs.remove(tid).catch(() => {});
          if (url) { pageImgs = pageImgs || {}; pageImgs[k] = url; await DB.set('cm_imgs', pageImgs); }
          resolve(url || null);
        };
        const front = setTimeout(() => chrome.tabs.update(tid, { active: true }).catch(() => {}), 9000);
        const timer = setTimeout(() => finish(null), 60000);
        function onMsg(msg, sender) {
          if (!sender.tab || sender.tab.id !== tid || !msg || msg.type !== 'vetrina-cm-image') return;
          if (msg.url) finish(msg.url);
        }
        chrome.runtime.onMessage.addListener(onMsg);
      });
    });
    pending.set(k, p);
    p.finally(() => pending.delete(k));
    return p;
  }

  async function setExpNames(map) { expNames = { ...expNames, ...map }; await DB.set('cm_expnames', expNames); }

  // Espansioni il cui nome (senza spazi e simboli) è uguale al testo dato: "windfromthesea" → [5023]
  function findExp(key) {
    if (!cat) return [];
    const k = key.replace(/[^a-z0-9]/g, '');
    if (k.length < 2) return [];
    const ids = new Set([...cat.singles.map(p => p[2]), ...Object.keys(expNames).map(Number)]);
    return [...ids].filter(id => { const n = expName(id); return n && norm(n).replace(/[^a-z0-9]/g, '') === k; });
  }

  // Ricerca per parole del nome, eventualmente solo in alcune espansioni
  function searchIn(words, expIds, limit = 120) {
    if (!cat) return [];
    const ws = words.map(norm).filter(Boolean), only = expIds && expIds.length ? new Set(expIds) : null;
    const out = [];
    for (let i = 0; i < cat.singles.length && out.length < limit; i++) {
      const p = cat.singles[i];
      if (only && !only.has(p[2])) continue;
      if (ws.every(w => cat.idx[i].includes(w))) out.push(p);
    }
    return out.map(([id, name, exp]) => ({ idProduct: id, name, idExpansion: exp, expansion: expName(exp) }));
  }

  return {
    canLoad, load, search, searchIn, findExp, priceOf, expName, isPromoExp, setExpNames, imageOf, fetchImage,
    get ready() { return !!cat; },
    get counts() { return cat ? { singles: cat.singles.length, sealed: cat.sealed.length, at: cat.at, prices: prices && prices.created, named: Object.keys(expNames).length } : null; }
  };
})();

// ---------- Prezzo minimo Cardmarket nella lingua della carta (alternativa a eBay) ----------
// Il listino pubblico di Cardmarket mescola tutte le lingue: il minimo di una carta italiana o giapponese si legge
// dalla pagina del prodotto con i filtri lingua + condizione NM. L'app sposta una scheda di Cardmarket in background
// (la "scheda di lavoro") da una carta all'altra e content-cm-price.js ne legge le offerte. Se Cardmarket chiede la
// verifica di sicurezza, la scheda passa in primo piano: completala e la lettura riprende.
const CMMIN = (() => {
  const LANG_ID = { en: 1, fr: 2, de: 3, es: 4, it: 5, zh: 6, ja: 7, pt: 8, ru: 9, ko: 10 };
  const TTL = 60 * 864e5; // 2 mesi, come i venduti eBay (ricontrollo a mano con il pulsante)
  const isExt = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.tabs);
  let cache = {}, urls = {};
  const ready = Promise.all([DB.get('cm_min'), DB.get('cm_urls')]).then(([a, b]) => { cache = a || {}; urls = b || {}; }).catch(() => {});
  let saveT = null;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { DB.set('cm_min', cache); DB.set('cm_urls', urls); }, 800); };
  // o: { reverse: true/false/undefined, first: true/false/undefined }
  const keyOf = (id, lang, o = {}) => `${id}|${lang}|${o.reverse == null ? '' : o.reverse ? 'R' : 'r'}${o.first == null ? '' : o.first ? 'F' : 'f'}`;
  // V: versione della lettura della pagina. I minimi letti prima (v < 2) potevano avere la quantità attaccata
  // al prezzo (1 + 12,00 € → 112,00 €): non valgono più e si rileggono.
  const V = 2;
  const get = (id, lang, o) => { const c = id && cache[keyOf(id, lang, o)]; return c && c.v === V ? c : null; };
  const fresh = (id, lang, o) => { const c = get(id, lang, o); return !!(c && Date.now() - c.at < TTL); };

  const listeners = new Set();
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const status = { state: 'idle', msg: '', at: 0 };
  const setStatus = (state, msg = '') => { Object.assign(status, { state, msg, at: Date.now() }); listeners.forEach(f => f()); };

  let worker = null, waiter = null;
  function done(v) { if (waiter) { const w = waiter; waiter = null; clearTimeout(w.timer); w.resolve(v); } }
  if (isExt) {
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (!msg || msg.type !== 'vetrina-cm-page' || !sender.tab || sender.tab.id !== worker) return;
      if (msg.challenge) {
        setStatus('challenge');
        chrome.tabs.update(worker, { active: true }).catch(() => {});
        if (waiter) { clearTimeout(waiter.timer); const w = waiter; w.timer = setTimeout(() => { if (waiter === w) done(null); }, 180000); }
        return;
      }
      done(msg);
    });
    chrome.tabs.onRemoved.addListener(id => { if (id === worker) { worker = null; done(null); } });
  }
  async function visit(url) {
    done(null);
    const p = new Promise(resolve => { waiter = { resolve, timer: setTimeout(() => { waiter = null; resolve(null); }, 40000) }; });
    const open = async () => { const t = await chrome.tabs.create({ url, active: false }); worker = t.id; };
    if (!worker) await open(); else await chrome.tabs.update(worker, { url }).catch(open);
    return p;
  }
  function closeWorker() { if (worker) { chrome.tabs.remove(worker).catch(() => {}); worker = null; } }

  async function fetchMin(id, lang, o = {}) {
    await ready;
    let base = urls[id];
    if (!base) {
      const r = await visit(`https://www.cardmarket.com/en/Pokemon/Products?idProduct=${id}`);
      if (!r) throw new Error('timeout');
      base = r.page.split('?')[0].replace(/^(https:\/\/www\.cardmarket\.com\/)[a-z]{2}\//, '$1en/');
      if (!/\/Products\/Singles\//.test(base)) throw new Error('not a card page');
      urls[id] = base;
    }
    const q = new URLSearchParams({ language: LANG_ID[lang] || 1, minCondition: 2 });
    if (o.reverse != null) q.set('isReverseHolo', o.reverse ? 'Y' : 'N');
    if (o.first != null) q.set('isFirstEd', o.first ? 'Y' : 'N');
    const r = await visit(`${base}?${q}`);
    if (!r) throw new Error('timeout');
    if (!r.rows && !r.empty) throw new Error('pagina non riconosciuta');
    cache[keyOf(id, lang, o)] = { p: r.p, n: r.n, at: Date.now(), v: V };
    persist();
    return cache[keyOf(id, lang, o)];
  }

  const queue = [], queued = new Map(); let running = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function want(id, lang, o = {}, force = false) {
    if (!isExt || !id) return Promise.resolve(null);
    if (!force && fresh(id, lang, o)) return Promise.resolve(get(id, lang, o));
    const k = keyOf(id, lang, o);
    if (queued.has(k)) return queued.get(k);
    let res; const p = new Promise(r => (res = r));
    queued.set(k, p); queue.push({ id, lang, o, k, res });
    run();
    return p;
  }
  async function run() {
    if (running) return; running = true;
    let fails = 0;
    try {
      while (queue.length) {
        const j = queue.shift();
        setStatus('reading');
        try {
          const v = await fetchMin(j.id, j.lang, j.o);
          queued.delete(j.k); j.res(v); fails = 0;
          await sleep(1200);
        } catch (e) {
          console.warn('Vetrina: minimo Cardmarket non letto', j.id, e.message);
          queued.delete(j.k); j.res(get(j.id, j.lang, j.o));
          setStatus('error', e.message);
          if (++fails >= 5) { await sleep(120000); fails = 0; } else await sleep(1500);
        }
      }
    } finally { running = false; closeWorker(); if (status.state !== 'error' && status.state !== 'challenge') setStatus('idle'); }
  }
  return { isExt, ready, get, fresh, want, onUpdate, status, V, get pending() { return queue.length; } };
})();

// ---------- Topsun (dati locali) ----------
const TOPSUN = (() => {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = () => (typeof TOPSUN_CARDS !== 'undefined' ? TOPSUN_CARDS : []).map(([id, n, name, imgUrl]) => ({
    id, localId: n, name: name + (/pr$/.test(id) ? ' (Prism)' : ''), imgUrl, prism: /pr$/.test(id)
  }));
  function search(q) {
    const words = norm(q).split(/\s+/).filter(w => w && w !== 'topsun');
    const all = list();
    if (!words.length) return /topsun/i.test(q) ? all : [];
    return all.filter(c => words.every(w => norm(c.name + ' ' + c.localId).includes(w)));
  }
  return { list, search };
})();

// ---------- Ricerca "intelligente" ----------
// Capisce nome (anche con errori di battitura e in qualsiasi lingua), espansione (nome o sigla) e numero:
// "Nidokikg ec3 088", "Nidoking wind from the sea", "ニドキング 海からの風".
const SMART = (() => {
  const key = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFKC').toLowerCase().replace(/[\s\-'’.·:,!?&()\[\]★☆♀♂]/g, '');

  // Nomi inglesi (come su Cardmarket) dei vecchi set giapponesi che TCGdex ha solo in giapponese
  const JA_ALIASES = {
    PMCG1: ['Base Expansion Pack', 'Expansion Pack', 'Base Set JP'], PMCG2: ['Pokemon Jungle', 'Jungle'], PMCG3: ['Mystery of the Fossils', 'Fossil'],
    PMCG4: ['Rocket Gang', 'Team Rocket'], PMCG5: ["Leaders' Stadium", 'Gym Heroes'], PMCG6: ['Challenge from the Darkness', 'Gym Challenge'],
    neo1: ['Gold, Silver, to a New World', 'Neo Genesis'], neo2: ['Crossing the Ruins', 'Neo Discovery'], neo3: ['Awakening Legends', 'Neo Revelation'],
    neo4: ['Darkness, and to Light', 'Neo Destiny'], VS1: ['Pokemon VS', 'VS'], web1: ['Pokemon Web', 'web'],
    E1: ['Base Expansion Pack e', 'Expedition e1', 'e1', 'ec1'], E2: ['The Town on No Map', 'Town on No Map', 'e2', 'ec2'],
    E3: ['Wind from the Sea', 'e3', 'ec3'], E4: ['Split Earth', 'e4', 'ec4'], E5: ['Mysterious Mountains', 'e5', 'ec5'],
    ADV2: ['Miracle of the Desert'], ADV3: ['Rulers of the Heavens'], ADV5: ['Undone Seal'], PCG1: ['Flight of Legends'], PCG2: ['Clash of the Blue Sky'],
    PCG3: ['Rocket Gang Strikes Back'], PCG4: ['Golden Sky, Silver Ocean'], PCG5: ['Mirage Forest'], PCG6: ['Holon Research Tower'], PCG7: ['Holon Phantom'],
    PCG8: ['Miracle Crystal'], PCG9: ['Offense and Defense of the Furthest Ends'], SV2a: ['Pokemon Card 151 JP']
  };

  // ---- Pokédex: nome → numero, con tolleranza agli errori ----
  let dex = null;
  function dexIndex() {
    if (dex) return dex;
    dex = { exact: new Map(), list: [] };
    (typeof POKEDEX !== 'undefined' ? POKEDEX : []).forEach(([id, en, ...rest]) => {
      [en, ...rest].forEach(n => { const k = key(n); if (!k) return; if (!dex.exact.has(k)) dex.exact.set(k, { id, en }); dex.list.push([k, id, en]); });
    });
    return dex;
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && i > 1 && j > 1) cur[j] = Math.min(cur[j], prev[j - 2] + 1);
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // Cerca un Pokémon tra le parole (anche di due parole, es. "Mr. Mime"). Restituisce { id, en, start, len, fixed }
  function findPokemon(words) {
    const d = dexIndex();
    for (const len of [3, 2, 1]) for (let i = 0; i + len <= words.length; i++) {
      const k = key(words.slice(i, i + len).join(''));
      if (d.exact.has(k)) return { ...d.exact.get(k), start: i, len, fixed: false };
    }
    let best = null;
    words.forEach((w, i) => {
      const k = key(w);
      if (k.length < 4 || /^\d/.test(k)) return;
      const max = /[぀-ヿ一-鿿]/.test(k) ? 1 : k.length >= 7 ? 2 : 1;
      for (const [n, id, en] of d.list) {
        const dist = lev(k, n, max);
        if (dist <= max && (!best || dist < best.dist)) best = { id, en, start: i, len: 1, fixed: true, dist };
      }
    });
    return best;
  }

  // ---- Espansioni: nome, sigla o alias → [{ lang, id, name }] ----
  async function setIndex(langs) {
    const idx = new Map();
    const add = (k, v) => { k = key(k); if (!k) return; if (!idx.has(k)) idx.set(k, []); if (!idx.get(k).some(x => x.lang === v.lang && x.id === v.id)) idx.get(k).push(v); };
    for (const lang of langs) {
      let sets = [];
      try { sets = await API.getSets(lang); } catch { /* offline */ }
      sets.forEach(s => {
        const v = { lang, id: s.id, name: s.name };
        add(s.id, v); add(s.name, v);
        if (lang === 'ja' && JA_ALIASES[s.id]) JA_ALIASES[s.id].forEach(a => add(a, v));
      });
    }
    return idx;
  }

  const ROMAJI_OWNERS = { sakaki: 'giovanni', kasumi: 'misty', takeshi: 'brock', matis: 'surge', machisu: 'surge', natsume: 'sabrina',
    kyo: 'koga', kyou: 'koga', katsura: 'blaine', hibiki: 'ethan' };
  const PROMO_WORD =/^(unp|unnumbered|promo|promos|promozionale|corocoro|coro|vending|wotc|blackstar|プロモ|コロコロ)$/i;
  const isPromoSet = s => /promo|プロモ|^p$|-p$|^svp$|^smp$|^swshp$|^xyp$|^bwp$|^mep$/i.test(String(s.setId || '')) || /promo|プロモ/i.test(String(s.setName || ''));
  const isNum = w => /^#?[a-z]{0,4}\d+[a-z]?(\/[a-z]{0,4}\d+)?$/i.test(w) && /\d/.test(w);

  async function parse(q, lang) {
    // nomi giapponesi e nomi di allenatori in rōmaji → inglese, come nel catalogo Cardmarket
    // ("サカキのニドキング" → "Giovanni's Nidoking", "sakaki nidoking" → "giovanni nidoking")
    const words = q.trim().split(/\s+/).filter(Boolean).flatMap(w => {
      if (/[^\x00-\x7f]/.test(w) && !PROMO_WORD.test(w)) { const e = englishName(w); return e !== w ? e.split(' ') : [w]; }
      return [ROMAJI_OWNERS[w.toLowerCase()] || w];
    });
    const used = new Array(words.length).fill(false);
    const out = { words, sets: [], cmExp: [], setLabel: null, num: null, pokemon: null, nameWords: [], promo: false };
    // "UNP", "promo", "CoroCoro"…: non fanno parte del nome, indicano una carta promozionale
    words.forEach((w, i) => { if (PROMO_WORD.test(w)) { used[i] = true; out.promo = true; } });
    const langs = [...new Set([lang, 'en', 'ja'])];
    const idx = await setIndex(langs);
    // espansione: la sequenza di parole più lunga che corrisponde a un set (o a un'espansione Cardmarket)
    for (let len = Math.min(7, words.length); len >= 1 && !out.setLabel; len--) {
      for (let i = 0; i + len <= words.length; i++) {
        if (used.slice(i, i + len).some(Boolean)) continue;
        const k = key(words.slice(i, i + len).join(''));
        if (k.length < 2) continue;
        if (len === words.length && !words.some(isNum)) continue; // tutta la ricerca = un set: lascia decidere al nome
        if (dexIndex().exact.has(k)) continue; // "Arceus" è sia un set sia un Pokémon: vale il Pokémon
        const hits = idx.get(k) || [];
        let cm = typeof CM !== 'undefined' ? CM.findExp(k) : [];
        // set riconosciuto da sigla (es. "e3"): cerca su Cardmarket il suo nome inglese
        if (hits.length && !cm.length && typeof CM !== 'undefined') {
          const names = hits.flatMap(h => [h.name, ...((h.lang === 'ja' && JA_ALIASES[h.id]) || [])]);
          cm = [...new Set(names.flatMap(n => CM.findExp(key(n))))];
        }
        if (hits.length || cm.length) {
          out.sets = hits; out.cmExp = cm;
          out.setLabel = (hits.find(h => h.lang === lang) || hits[0] || {}).name || (cm.length ? CM.expName(cm[0]) : words.slice(i, i + len).join(' '));
          for (let j = i; j < i + len; j++) used[j] = true;
          break;
        }
      }
    }
    // numero
    words.forEach((w, i) => { if (!used[i] && !out.num && isNum(w)) { out.num = w.replace('#', '').split('/')[0]; used[i] = true; } });
    const rest = words.filter((_, i) => !used[i]);
    out.pokemon = findPokemon(rest);
    out.nameWords = rest;
    return out;
  }

  const stripZeros = x => String(x).replace(/^[a-z]*0*/i, '').toLowerCase();
  function numMatch(card, num) {
    const a = stripZeros(card.localId), b = stripZeros(num);
    return a === b || String(card.localId).toLowerCase() === num.toLowerCase();
  }

  async function fetchLang(lang, p, name) {
    const lists = [];
    if (name) lists.push(API.searchCards(lang, name).catch(() => []));
    if (p) lists.push(API.searchDex(lang, p.id).catch(() => []));
    const seen = new Set(), out = [];
    (await Promise.all(lists)).flat().forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } });
    return out;
  }

  // Risultato: { main: [...], others: [{ lang, list }], fixed: 'Nidoking'|null, setLabel, num, numIgnored, cmWords, cmExp }
  async function search(lang, q) {
    const P = await parse(q, lang);
    const p = P.pokemon;
    // parole del nome con l'eventuale correzione
    let nameWords = P.nameWords.slice();
    if (p && p.fixed) nameWords.splice(p.start, p.len, p.en);
    const name = nameWords.join(' ');
    const setLangs = [...new Set(P.sets.map(s => s.lang))];
    const langs = [...new Set([lang, ...(P.sets.length ? setLangs : ['en', 'ja'])])];
    const res = {};
    await Promise.all(langs.map(async l => {
      let list = await fetchLang(l, p, p && !p.fixed && l === lang ? name : (p ? null : name));
      if (P.sets.length) list = list.filter(c => P.sets.some(s => s.lang === l && s.id === c.setId));
      res[l] = list;
    }));
    // numero: se non corrisponde nulla lo ignora (es. "888" invece di "088")
    let numIgnored = false;
    if (P.num) {
      const filtered = {}; let any = false;
      langs.forEach(l => { filtered[l] = res[l].filter(c => numMatch(c, P.num)); if (filtered[l].length) any = true; });
      if (any) Object.assign(res, filtered); else numIgnored = true;
    }
    // "promo"/"UNP": tiene solo le carte promozionali, se ce ne sono
    if (P.promo) {
      const filtered = {}; let any = false;
      langs.forEach(l => { filtered[l] = res[l].filter(isPromoSet); if (filtered[l].length) any = true; });
      if (any) Object.assign(res, filtered);
    }
    const sortL = list => list.sort((a, b) => b.order - a.order || String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }));
    const main = sortL(res[lang] || []);
    // altre lingue: sempre se il set è solo lì, altrimenti quando nella lingua scelta c'è poco
    const others = langs.filter(l => l !== lang && res[l] && res[l].length && (P.sets.length || P.promo || main.length < 6))
      .map(l => ({ lang: l, list: sortL(res[l]) }));
    return {
      main, others, fixed: p && p.fixed ? p.en : null, setLabel: P.setLabel, num: P.num, numIgnored,
      cmWords: p ? [...P.nameWords.slice(0, p.start), p.en, ...P.nameWords.slice(p.start + p.len)] : nameWords,
      cmExp: P.cmExp, pokemon: p, promo: P.promo
    };
  }

  // Nome inglese di una carta giapponese per le ricerche eBay: "ニドキング" → "Nidoking",
  // "リザードンex" → "Charizard ex", "メガリザードンXex" → "Mega Charizard X ex". Nomi latini: invariati.
  function englishName(name) {
    const k = key(name), d = dexIndex();
    if (!/[^\x00-\x7f]/.test(k)) return name;
    if (d.exact.has(k)) return d.exact.get(k).en;
    let best = null;
    for (const [n, , en] of d.list) if (n.length >= 2 && /[^\x00-\x7f]/.test(n) && k.includes(n) && (!best || n.length > best.n.length)) best = { n, en };
    if (!best) return name;
    const after = k.slice(k.indexOf(best.n) + best.n.length);
    const form = (after.match(/^[xy](?=ex|$)/) || [''])[0].toUpperCase();
    const suf = (after.match(/(vmax|vstar|vunion|gx|ex|v|break|lvx)$/) || [])[1];
    const mega = /^メガ/.test(k) ? 'Mega ' : '';
    // carte "di un allenatore" (サカキのニドキング = Giovanni's Nidoking)
    const OWNERS = { 'サカキの': "Giovanni's ", 'カスミの': "Misty's ", 'タケシの': "Brock's ", 'マチスの': "Lt. Surge's ", 'エリカの': "Erika's ",
      'ナツメの': "Sabrina's ", 'キョウの': "Koga's ", 'カツラの': "Blaine's ", 'ロケット団の': "Team Rocket's ", 'ヒビキの': "Ethan's ", 'わるい': 'Dark ',
      'ひかる': 'Shining ', 'やさしい': 'Light ', 'Rの': "Team Rocket's " };
    const owner = Object.keys(OWNERS).find(o => k.startsWith(key(o)));
    return `${owner ? OWNERS[owner] : ''}${mega}${best.en}${form ? ' ' + form : ''}${suf ? ' ' + (suf === 'ex' ? 'ex' : suf.toUpperCase()) : ''}`;
  }

  return { search, parse, findPokemon, englishName, key };
})();

// ---------- eBay: venduti ----------
const EBAY = (() => {
  const isExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.tabs;
  const CUR = { 'ebay.it': 'EUR', 'ebay.de': 'EUR', 'ebay.fr': 'EUR', 'ebay.es': 'EUR', 'ebay.com': 'USD', 'ebay.co.uk': 'GBP' };

  // categorie eBay: 183454 = carte singole CCG, 2536 = giochi di carte collezionabili (per il sigillato)
  // active: annunci IN VENDITA (non venduti), es. la stima di un master set completo
  function url(domain, query, cat = '183454', active = false) {
    return `https://www.${domain}/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=${cat}${active ? '' : '&LH_Sold=1&LH_Complete=1&_sop=13'}&_ipg=120`;
  }

  async function sold(domain, query, cat, opts = {}) {
    const u = url(domain, query, cat, !!opts.active);
    if (!isExt) { if (!opts.silent) window.open(u, '_blank'); return { error: 'noext', url: u }; }
    try {
      const r = await fetch(u, { credentials: 'include' });
      if (r.ok && !/signin\./.test(r.url)) {
        const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
        const items = VetrinaEbay.parseEbayDocument(doc);
        if (items.length) return { items, url: u, currency: CUR[domain] };
      }
    } catch { /* passa alla scheda */ }
    return new Promise(resolve => {
      chrome.tabs.create({ url: u + '#vetrina', active: false }, tab => {
        const tid = tab.id;
        let finished = false;
        const done = (v, closeTab) => {
          if (finished) return; finished = true;
          clearTimeout(timer); chrome.runtime.onMessage.removeListener(onMsg);
          if (closeTab) chrome.tabs.remove(tid).catch(() => {});
          resolve({ url: u, currency: CUR[domain], ...v });
        };
        const timer = setTimeout(() => done({ error: 'failed' }, true), 30000);
        function onMsg(msg, sender) {
          if (!sender.tab || sender.tab.id !== tid) return;
          if (msg.type === 'vetrina-ebay') done({ items: msg.items }, true);
          else if (msg.type === 'vetrina-ebay-login') { chrome.tabs.update(tid, { active: true }); done({ error: 'login' }, false); }
        }
        chrome.runtime.onMessage.addListener(onMsg);
      });
    });
  }

  // Enti di gradazione: come compaiono nei titoli delle inserzioni
  const GRADERS = {
    PSA: /\bPSA\b/i,
    BGS: /\b(BGS|Beckett)\b/i,
    CGC: /\bCGC\b/i,
    AiGrading: /\bA\.?I\.?[\s-]?Grad(ing|ed|ed card)?\b|\bAIGRADING\b|\bAIG\b/i,
    GRAAD: /\bGRAAD\b/i,
    TAG: /\bTAG\b(?![\s-]*team)|\bTAG[\s-]?grad/i,
    ACE: /\bACE\b(?![\s-]*spec)/i,
    SGC: /\bSGC\b/i,
    PCA: /\bPCA\b/i
  };
  const GRADED = /\b(PSA|BGS|CGC|BECKETT|SGC|PCA|MNA|GRAAD|AIGRADING|GRADED|GRADATA|GRADATO|Collect\s?Aura|GEM\s?MINT\s?10)\b|\bA\.?I\.?[\s-]?Grad|\bTAG\b(?![\s-]*team)|\bACE\b\s*\d/i;
  const anyGrader = t => Object.entries(GRADERS).filter(([, re]) => re.test(t)).map(([k]) => k);
  // voto subito dopo l'ente (o a pochi caratteri): "PSA 10", "BGS 9.5", "TAG Pristine 10", "PSA GEM MINT 10"
  function gradeMatches(t, co, g) {
    const re = GRADERS[co] || new RegExp('\\b' + co + '\\b', 'i');
    const m = t.match(new RegExp('(?:' + re.source + ')[^0-9]{0,22}?(\\d{1,2}(?:[.,]5)?)(?![\\d/])', 'i'));
    if (!m || m[m.length - 1] == null) return null; // voto non leggibile
    return parseFloat(m[m.length - 1].replace(',', '.')) === parseFloat(String(g).replace(',', '.'));
  }
  const LOT = /\b(lotto|lot|bundle|playset|set completo|collection|collezione|proxy|custom|fake|replica|jumbo|oversize|metal|sleeve|binder|booster|display|etb)\b|\b\d+\s?x\b|\bx\s?\d+\b/i;
  const LANGS = {
    it: /\b(ita|italian[oa]?|italy)\b/i,
    en: /\b(eng|english|inglese|englisch)\b/i,
    ja: /\b(jap|jp|jpn|japanese|japan|giappones[ei]|japonais)\b|日本/i,
    fr: /\b(fra|fran[cç]ais[e]?|french|francese)\b/i,
    de: /\b(deutsch|german|tedesc[ao]|ger)\b/i,
    es: /\b(esp|espa[ñn]ol|spanish|spagnol[ao])\b/i,
    pt: /\b(portugu[eê]s|portuguese|portoghese)\b/i,
    ko: /\b(korean|coreano|kor)\b/i,
    zh: /\b(chinese|cinese|chn|s-chinese|t-chinese)\b/i
  };

  function autoExcluded(item, card) {
    const t = item.title;
    const g = card.grade && card.grade.co;
    if (g) {
      const found = anyGrader(t);
      if (!found.includes(g)) return true; // altro ente o non gradata
      if (card.grade.g && gradeMatches(t, g, card.grade.g) !== true) return true; // voto diverso o non indicato
      // BGS 10: il Black Label (tutti i sottovoti 10) vale molto più del Pristine 10
      if (g === 'BGS' && parseFloat(String(card.grade.g).replace(',', '.')) >= 10) {
        const bl = /black\s*label|\bBL\b|blacklabel/i.test(t);
        if (card.grade.black ? !bl : bl) return true;
      }
    } else if (GRADED.test(t)) return true;
    // "Classic Collection" è il nome della serie, non un lotto: tolto prima del controllo dei lotti
    const CLASSIC_RE = /classic\s*collection|collezione\s*classica/gi;
    if (LOT.test(t.replace(CLASSIC_RE, ' '))) return true;
    // Classic Collection: solo le ristampe (titolo con "classic"); per le altre carte niente ristampe Classic Collection
    const classicSet = card.setId === '30th-c' || card.setId === 'cel25cc';
    const classicT = /classic\s*collection|collezione\s*classica|\bclassic\b/i.test(t);
    if (classicSet ? !classicT : /classic\s*collection|collezione\s*classica/i.test(t)) return true;
    // 1ª edizione e shadowless: solo le vendite della stessa versione
    const first = /\b1st\s*(ed|edition)\b|first\s*edition|1\.?\s*ed(ition|izione)?\b|prima\s*edizione|erste\s*edition/i.test(t);
    const shadowless = /shadow\s*less|no\s*shadow|senza\s*ombra/i.test(t);
    if ((card.variant === 'firstEdition') !== first) return true;
    // (la 1ª edizione del Set Base è sempre shadowless: spesso il titolo non lo dice)
    if (card.finish !== 'shadowless1st' && (card.finish === 'shadowless') !== shadowless && (card.setId === 'base1' || shadowless)) return true;
    if (card.setId === 'base1' && (card.finish === 'print1999') !== /1999\s*-?\s*2000|4th\s*print|uk\s*print/i.test(t)) return true;
    for (const [l, re] of Object.entries(LANGS)) if (l !== card.lang && re.test(t) && !(LANGS[card.lang] && LANGS[card.lang].test(t))) return true;
    return false;
  }

  // Prodotti sigillati: scarta scatole vuote/aperte e altre lingue.
  const NOT_SEALED = /\b(vuot[oa]|empty|apert[oa]|opened|aperto|leer|solo scatola|box only|no booster|senza buste|proxy|replica|fake|custom|display stand|sleeves?|bustine sfuse)\b/i;
  function autoExcludedSealed(item, prod) {
    const t = item.title;
    if (NOT_SEALED.test(t)) return true;
    for (const [l, re] of Object.entries(LANGS)) if (l !== prod.lang && re.test(t) && !(LANGS[prod.lang] && LANGS[prod.lang].test(t))) return true;
    return false;
  }

  function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // Calcola le statistiche sulle vendite incluse (prezzi già in EUR).
  function stats(results, excluded, manualIncluded) {
    const inc = results.filter(r => manualIncluded.includes(r.id) || (!excluded.includes(r.id) && !r.auto));
    let vals = inc.map(r => r.eur).filter(v => v > 0);
    const med0 = median(vals);
    // scarta valori anomali (oltre 4 volte o sotto 1/4 della mediana)
    const outl = med0 ? inc.filter(r => !manualIncluded.includes(r.id) && (r.eur > med0 * 4 || r.eur < med0 / 4)).map(r => r.id) : [];
    const used = inc.filter(r => !outl.includes(r.id));
    vals = used.map(r => r.eur);
    if (!vals.length) return { count: 0, usedIds: [] };
    return {
      count: vals.length, median: median(vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      min: Math.min(...vals), max: Math.max(...vals), usedIds: used.map(r => r.id)
    };
  }

  return { isExt, url, sold, autoExcluded, autoExcludedSealed, stats, median };
})();

// ---------- immagini dal web: loghi dei set e foto dei prodotti sigillati ----------
// Fonte: archivio immagini di Bulbapedia (archives.bulbagarden.net), interrogabile dalle pagine web.
// Le immagini vanno caricate senza "referrer" (attributo referrerpolicy="no-referrer"), altrimenti il sito le blocca.
const WEBIMG = (() => {
  const API_URL = 'https://archives.bulbagarden.net/w/api.php';
  const mem = new Map();
  async function search(q, width = 480) {
    const key = q + '|' + width;
    if (mem.has(key)) return mem.get(key);
    const u = `${API_URL}?action=query&generator=search&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url&iiurlwidth=${width}&format=json&origin=*&gsrsearch=${encodeURIComponent(q)}`;
    const p = fetch(u).then(r => r.ok ? r.json() : null).then(j => Object.values((j && j.query && j.query.pages) || {})
      .sort((a, b) => a.index - b.index)
      .map(x => ({ title: x.title.replace(/^File:/, ''), url: x.imageinfo && x.imageinfo[0] && (x.imageinfo[0].thumburl || x.imageinfo[0].url) }))
      .filter(x => x.url && /\.(png|jpe?g|webp)$/i.test(x.title)))
      .catch(() => { mem.delete(key); return []; });
    mem.set(key, p);
    return p;
  }
  const norm = s => s.toLowerCase().replace(/[_\-–]+/g, ' ').replace(/é/g, 'e');
  // parola (o frase) intera: "tin" non deve trovare "Tinkatuff"
  const has = (title, w) => new RegExp('(^|[^a-z0-9])' + norm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(norm(title));
  const OTHER_LANGS = ['indonesian', 'thai', 'korean', 'chinese', 'taiwan', 'german', 'french', 'spanish', 'portuguese'];

  async function setLogo({ lang, name, enName, setId }) {
    const qs = lang === 'ja' ? [`${setId} Logo JP`, `${name} logo`] : [`${enName || name} logo`, `${setId} Logo EN`];
    const tag = lang === 'ja' ? ' jp' : ' en';
    for (const q of qs) {
      const list = (await search(q, 400)).filter(x => has(x.title, 'logo') && !OTHER_LANGS.some(l => has(x.title, l)));
      const best = list.find(x => norm(x.title).includes(tag + '.')) || list.find(x => !/ (en|jp)\./.test(norm(x.title)));
      if (best) return best.url;
    }
    return null;
  }

  // foto del prodotto sigillato: ogni gruppo di "must" vuole almeno una delle parole; "avoid" le esclude
  const NOT = ['contents', 'coin', 'logo', 'card'];
  const PRODUCT = {
    etb: { q: 'Elite Trainer Box', must: [['elite trainer box', 'etb']], avoid: ['center', 'pc'] },
    pc_etb: { q: 'Pokémon Center Elite Trainer Box', must: [['elite trainer box', 'etb'], ['center', 'pc']], avoid: [] },
    booster_box: { q: 'Booster Display Box', must: [['booster display', 'display box', 'booster box']], avoid: ['half', 'bundle', 'mini'] },
    half_box: { q: 'Booster Box', must: [['booster box', 'half booster', 'display box']], avoid: ['bundle'] },
    booster_bundle: { q: 'Booster Bundle', must: [['booster bundle']], avoid: [] },
    upc: { q: 'Ultra-Premium Collection', must: [['ultra premium', 'upc']], avoid: [] },
    premium: { q: 'Premium Collection', must: [['premium collection']], avoid: ['ultra'] },
    collection: { q: 'Collection', must: [['collection', 'box']], avoid: ['elite', 'etb', 'display', 'bundle'] },
    tin: { q: 'Tin', must: [['tin']], avoid: ['mini'] },
    mini_tin: { q: 'Mini Tin', must: [['mini tin']], avoid: [] },
    blister3: { q: 'Three-Booster Blister', must: [['blister', '3 pack', 'three booster']], avoid: [] },
    blister1: { q: 'Blister', must: [['blister', 'checklane']], avoid: ['three', '3 pack'] },
    booster: { q: 'Booster pack', must: [['booster']], avoid: ['box', 'bundle', 'blister', 'display'] },
    build_battle: { q: 'Build & Battle', must: [['build']], avoid: [] }
  };
  const fits = (x, spec) => spec.must.every(g => g.some(w => has(x.title, w))) && !spec.avoid.concat(NOT).some(w => has(x.title, w)) && !OTHER_LANGS.some(l => has(x.title, l));
  const code = x => norm(x.title).split(' ')[0];
  // tutte le foto trovate (per la scelta a mano), le più adatte prima
  async function productCandidates({ lang, type, name, enName, setId }) {
    const spec = PRODUCT[type];
    const base = lang === 'ja' ? (setId || name) : (enName || name);
    const qs = spec ? [`${base} ${spec.q}`] : [];
    qs.push(base);
    const seen = new Set(), out = [];
    for (const q of qs) for (const x of await search(q, 480)) if (!seen.has(x.url)) { seen.add(x.url); out.push(x); }
    // il primo risultato indica il codice del set su Bulbapedia (es. "SV2", "151", "ME1"): i file con lo stesso codice vengono prima
    const main = out.length ? code(out[0]) : '';
    const score = x => (spec && fits(x, spec) ? 0 : 2) + (code(x) === main ? 0 : 1) + (NOT.some(w => has(x.title, w)) ? 2 : 0);
    return out.map((x, i) => ({ ...x, i })).sort((a, b) => score(a) - score(b) || a.i - b.i);
  }
  async function product(o) {
    const spec = PRODUCT[o.type];
    if (!spec) return null;
    const list = await productCandidates(o);
    const main = list.length ? code(list.slice().sort((a, b) => a.i - b.i)[0]) : '';
    // solo foto dello stesso set (stesso codice del primo risultato): meglio nessuna foto che quella di un altro set
    const best = list.find(x => fits(x, spec) && code(x) === main);
    return best ? best.url : null;
  }
  // tag <img> per queste immagini (senza referrer)
  const img = (url, cls = '') => `<img ${cls ? `class="${cls}" ` : ''}src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  return { search, setLogo, product, productCandidates, img };
})();
