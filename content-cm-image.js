// Pagina di un prodotto su Cardmarket: legge l'immagine della carta e la passa all'app
// (che ascolta solo per la scheda aperta da lei: le altre visite non fanno nulla).
(() => {
  const find = () => {
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content && !/logo|default|placeholder/i.test(og.content)) return og.content;
    const imgs = [...document.querySelectorAll('img')].map(i => i.currentSrc || i.src || i.dataset.src || '');
    return imgs.find(s => /product-images|\/img\/items\/|\/\d{5,}\/\d{5,}\.(jpe?g|png|webp)/i.test(s)) || null;
  };
  let n = 0;
  const tick = () => {
    const url = find();
    if (url) { chrome.runtime.sendMessage({ type: 'vetrina-cm-image', url, page: location.href }).catch(() => {}); return; }
    if (++n < 40) setTimeout(tick, 500);
  };
  tick();
})();
