// Legge gli annunci da una pagina di ricerca eBay (layout "s-card" 2025 e il vecchio "s-item").
// Usato sia dallo script nella pagina eBay sia dall'app (su HTML scaricato).
(function (root) {
  const MONTHS = {
    gen: 0, feb: 1, mar: 2, apr: 3, mag: 4, giu: 5, lug: 6, ago: 7, set: 8, ott: 9, nov: 10, dic: 11,
    jan: 0, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, dec: 11,
    janv: 0, 'févr': 1, mars: 2, avr: 3, mai: 4, juin: 5, juil: 6, 'août': 7, sept: 8, oct_: 9, déc: 11,
    ene: 0, abr: 3, ago_: 7, dic_: 11, okt: 9, dez: 11, mär: 2
  };

  function parsePrice(txt) {
    if (!txt) return null;
    const t = txt.replace(/ /g, ' ');
    let cur = null;
    if (/EUR|€/.test(t)) cur = 'EUR';
    else if (/GBP|£/.test(t)) cur = 'GBP';
    else if (/JPY|¥|円/.test(t)) cur = 'JPY';
    else if (/\$|USD/.test(t)) cur = 'USD';
    const m = t.match(/\d[\d.,\s]*/);
    if (!m) return null;
    let n = m[0].replace(/\s/g, '');
    const lastComma = n.lastIndexOf(','), lastDot = n.lastIndexOf('.');
    if (lastComma > lastDot) n = n.replace(/\./g, '').replace(',', '.');      // 1.234,56
    else n = n.replace(/,/g, '');                                               // 1,234.56
    const v = parseFloat(n);
    return isFinite(v) ? { value: v, currency: cur } : null;
  }

  function parseSoldDate(txt) {
    const m = txt.match(/(?:Vendut[oai]|Sold|Verkauft|Vendu|Vendido)\s+(?:il\s+|le\s+|am\s+|el\s+)?(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})/i)
      || txt.match(/(?:Sold)\s+([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
    if (!m) return null;
    let d, mo, y;
    if (/^\d/.test(m[1])) { d = +m[1]; mo = m[2]; y = +m[3]; } else { mo = m[1]; d = +m[2]; y = +m[3]; }
    const key = mo.toLowerCase().slice(0, 4);
    let mi = MONTHS[key]; if (mi === undefined) mi = MONTHS[key.slice(0, 3)];
    if (mi === undefined) return null;
    const dt = new Date(Date.UTC(y, mi, d));
    return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
  }

  function parseEbayDocument(doc) {
    const out = [];
    // Dopo il separatore "Risultati che corrispondono a meno parole" eBay mette annunci che NON contengono
    // tutte le parole cercate (es. la carta originale invece della ristampa Classic Collection): ci si ferma lì.
    const FEWER = /meno parole|fewer words|weniger (such)?w[öo]rter|moins de mots|menos palabras/i;
    const nodes = doc.querySelectorAll('li.s-card, li.s-item, li.srp-river-answer, .srp-river-answer');
    let stop = false;
    nodes.forEach(li => {
      if (stop) return;
      if (!li.matches('li.s-card, li.s-item')) {
        if (/REWRITE_START/.test(li.className) || FEWER.test(li.textContent || '')) stop = true;
        return;
      }
      if (/REWRITE_START/.test(li.className)) { stop = true; return; }
      const titleEl = li.querySelector('.s-card__title, .s-item__title');
      if (!titleEl) return;
      let title = (titleEl.textContent || '').trim();
      title = title.replace(/(viene aperta una nuova finestra o scheda|Opens in a new window or tab|Nuovo annuncio|New listing)/gi, '').trim();
      if (!title || /^Shop on eBay$/i.test(title)) return;
      const priceEl = li.querySelector('.s-card__price, .s-item__price');
      const p = parsePrice(priceEl && priceEl.textContent);
      if (!p) return;
      const link = li.querySelector('a.s-card__link[href*="/itm/"], a.s-item__link[href*="/itm/"], a[href*="/itm/"]');
      const url = link ? link.getAttribute('href').split('?')[0] : '';
      if (/\/itm\/123456$/.test(url)) return;
      const img = li.querySelector('img');
      const imgSrc = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
      const txt = (li.textContent || '').replace(/\s+/g, ' ');
      // asta: numero di offerte o tempo rimasto; prezzo "da X a Y": più versioni nello stesso annuncio
      const auction = !!li.querySelector('.s-item__bids, .s-item__bidCount') ||
        /\b\d+\s*(offert[ae]|bids?|Gebote?|ench[eè]res?|pujas?)\b/i.test(txt) || /tempo rimasto|time left|restzeit|temps restant|tiempo restante/i.test(txt);
      const range = /\d\s*(a|to|bis|à)\s*(EUR|€|£|\$|US)?\s*\d/i.test((priceEl && priceEl.textContent) || '');
      out.push({
        title, price: p.value, currency: p.currency, url, auction, range,
        img: /ebayimg/.test(imgSrc) ? imgSrc : '',
        date: parseSoldDate(txt),
        id: li.getAttribute('data-listingid') || url
      });
    });
    // elimina doppioni
    const seen = new Set();
    return out.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }

  root.VetrinaEbay = { parseEbayDocument, parsePrice, parseSoldDate };
})(typeof window !== 'undefined' ? window : self);
