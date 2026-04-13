function setActiveHashLink() {
  const hash = window.location.hash || '#overview';
  document.querySelectorAll('.main-nav a[href^="#"]').forEach((link) => {
    link.classList.toggle('is-active', link.getAttribute('href') === hash);
  });
}

function initRouter() {
  setActiveHashLink();
  window.addEventListener('hashchange', setActiveHashLink);
}

window.GN8RRouter = { initRouter };
