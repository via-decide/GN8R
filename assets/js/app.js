async function init() {
  try {
    window.GN8RUI.renderCards();
    window.GN8RUI.renderCommands();
    window.GN8RRouter.initRouter();

    const toggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.main-nav');

    const closeMenu = () => {
      if (!nav || !toggle) return;
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle?.addEventListener('click', () => {
      const open = nav?.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(Boolean(open)));
    });

    document.addEventListener('click', (event) => {
      const copyButton = event.target.closest('[data-copy]');
      if (copyButton) {
        const text = copyButton.getAttribute('data-copy') || '';
        navigator.clipboard.writeText(text).catch(() => {});
        window.GN8RUI.showModal(`Copied: ${text}`);
        return;
      }

      if (event.target.matches('[data-modal], [data-modal-close]')) {
        window.GN8RUI.closeModal();
      }

      if (nav?.classList.contains('is-open') && !event.target.closest('.main-nav, .menu-toggle')) {
        closeMenu();
      }
    });

    nav?.addEventListener('click', (event) => {
      if (event.target.matches('a')) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        window.GN8RUI.closeModal();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 760) closeMenu();
    });
  } catch (error) {
    console.error('UI boot error', error);
  }
}

document.addEventListener('DOMContentLoaded', init);
