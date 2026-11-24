// Gira nella pagina "Singles" di Cardmarket: legge l'elenco delle espansioni (id → nome) dal filtro
// e lo invia all'app Vetrina TCG, così le carte del catalogo mostrano il nome dell'espansione.
(function () {
  if (!/[?&]vetrina=1/.test(location.href)) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const opts = document.querySelectorAll('select[name="idExpansion"] option');
    if (opts.length > 10 || tries > 40) {
      clearInterval(timer);
      const map = {};
      opts.forEach(o => { const id = parseInt(o.value, 10); if (id > 0) map[id] = o.textContent.trim(); });
      chrome.runtime.sendMessage({ type: 'vetrina-cm-expansions', map });
    }
  }, 500);
})();
