// Pagina di una carta su Cardmarket aperta dall'app (scheda di lavoro): legge le offerte già filtrate da Cardmarket
// (lingua, condizione, reverse, 1ª edizione) e passa all'app il prezzo più basso.
// L'app ascolta solo la sua scheda di lavoro: le tue visite normali a Cardmarket non fanno nulla.
(() => {
  // Prezzo da UN solo testo (es. "12,00 €"). Gli spazi NON vanno tolti: unendo i testi della riga la quantità
  // ("1") si attaccava al prezzo e "1" + "12,00 €" diventava 112,00 €.
  const money = s => {
    const m = String(s).replace(/[  ]/g, ' ').match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\s?€|€\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    let t = m[1] || m[2];
    const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
    if (last >= 0 && t.length - last - 1 <= 2) t = t.slice(0, last).replace(/[.,]/g, '') + '.' + t.slice(last + 1);
    else t = t.replace(/[.,]/g, '');
    const v = parseFloat(t);
    return isFinite(v) && v > 0 ? v : null;
  };
  const isChallenge = () => !!document.querySelector('#challenge-form, #challenge-stage, .cf-turnstile, script[src*="challenge-platform"]') ||
    /just a moment|ci siamo quasi|un momento|verifica di sicurezza|security check/i.test(document.title);
  function read() {
    const table = document.querySelector('#table, .article-table, .table-body');
    const rows = [...document.querySelectorAll('.article-row, [id^="articleRow"]')];
    // prezzo dell'offerta: il primo testo con "€" dentro il riquadro del prezzo, letto da solo
    const priceOf = el => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const tx = n.nodeValue.trim();
        if (!tx) continue;
        if (/€/.test(tx)) { const v = money(tx); if (v != null) return v; }
        // cifra e "€" in due testi vicini
        const nx = n.parentElement && n.parentElement.nextSibling && n.parentElement.nextSibling.textContent;
        if (/^\d[\d.,]*$/.test(tx) && /^\s*€/.test(nx || '')) { const v = money(tx + ' €'); if (v != null) return v; }
      }
      return null;
    };
    const prices = rows.map(r => {
      const el = r.querySelector('.col-offer .price-container, .price-container, .col-price');
      return priceOf(el || r);
    }).filter(v => v != null);
    return { rows: rows.length, n: prices.length, p: prices.length ? Math.min(...prices) : null, empty: !!table && !rows.length, title: document.title.slice(0, 80) };
  }
  const send = extra => chrome.runtime.sendMessage({ type: 'vetrina-cm-page', page: location.href, ...extra }).catch(() => {});
  const cardPage = /\/Products\/Singles\//.test(location.pathname);
  let n = 0;
  const tick = () => {
    if (isChallenge()) { if (n++ % 6 === 0) send({ challenge: true }); setTimeout(tick, 1000); return; }
    if (!cardPage) return;
    const r = read();
    if (r.rows || r.empty || n >= 16) { send(r); return; }
    n++; setTimeout(tick, 500);
  };
  tick();
})();
