// Gira nelle pagine eBay: quando la pagina è una ricerca di "venduti", invia i risultati all'app Vetrina TCG.
(function () {
  const href = location.href;
  if (/^https:\/\/signin\.ebay\./.test(href)) {
    if (/LH_Sold/.test(decodeURIComponent(href))) chrome.runtime.sendMessage({ type: 'vetrina-ebay-login' });
    return;
  }
  // ricerche dei venduti, oppure pagine aperte dall'app (segno "#vetrina": es. annunci in vendita di un master set)
  if (!/[?&]LH_Sold=1/.test(href) && !/#vetrina/.test(href)) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const items = window.VetrinaEbay.parseEbayDocument(document);
    if (items.length || tries > 20) {
      clearInterval(timer);
      chrome.runtime.sendMessage({ type: 'vetrina-ebay', url: href, items });
    }
  }, 500);
})();
