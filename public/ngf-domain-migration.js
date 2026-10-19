(() => {
  const primary = new URL(document.querySelector('link[rel="canonical"]')?.href || location.href);
  if (primary.hostname !== 'newgalaxyfurniture.in') return;
  const target = new URL(location.href);
  if (target.hostname === 'newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev') {
    target.protocol = 'https:';
    target.host = primary.host;
    target.searchParams.set('__ngf_domain', '1');
    location.replace(target.href);
    return;
  }
  if (target.hostname !== primary.hostname || target.searchParams.get('__ngf_domain') !== '1')
    return;
  target.searchParams.delete('__ngf_domain');
  // A fresh same-origin response replaces the obsolete cached GoDaddy redirect.
  fetch(target.href, { cache: 'reload', redirect: 'error', credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) return;
      await response.text();
      history.replaceState(history.state, '', target.pathname + target.search + location.hash);
    })
    .catch(() => {
      // Keep the working marked address if offline or the old redirect is still active.
    });
})();
