function normalizePath(pathname) {
  return pathname.endsWith('/') ? `${pathname}index.html` : pathname;
}

function setActiveNavLink() {
  const currentPath = normalizePath(window.location.pathname);
  const hash = window.location.hash;

  document.querySelectorAll('.main-nav a').forEach((link) => {
    const url = new URL(link.getAttribute('href'), window.location.href);
    const linkPath = normalizePath(url.pathname);
    const samePath = currentPath === linkPath;
    const linkHash = url.hash;
    const isActive = linkHash ? samePath && linkHash === hash : samePath;
    link.classList.toggle('is-active', isActive);
  });
}

function initRouter() {
  setActiveNavLink();
  window.addEventListener('hashchange', setActiveNavLink);
}

window.GN8RRouter = { initRouter };
