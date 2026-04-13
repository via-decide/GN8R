async function loadComponent(selector, file) {
  const mount = document.querySelector(selector);
  if (!mount) return;
  const response = await fetch(file);
  if (!response.ok) throw new Error(`Failed to load ${file}`);
  mount.innerHTML = await response.text();
}

async function loadSharedUI() {
  await loadComponent('[data-header-slot]', '../components/header.html');
  await loadComponent('[data-footer-slot]', '../components/footer.html');
  await loadComponent('[data-modal-slot]', '../components/modal.html');
}

function renderCards() {
  const grid = document.querySelector('[data-cards]');
  const cards = window.GN8RState?.cards || [];
  if (!grid) return;
  grid.innerHTML = cards.map((card) => `\n    <article class="info-card"><h3>${card.title}</h3><p>${card.body}</p></article>`).join('');
}

function renderCommands() {
  const list = document.querySelector('[data-command-list]');
  const commands = window.GN8RState?.commands || [];
  if (!list) return;
  list.innerHTML = commands
    .map((command) => `<li><button class="copy-command" type="button" data-copy="${command}">${command}</button></li>`)
    .join('');
}

function showModal(text) {
  const modal = document.querySelector('[data-modal]');
  const content = document.querySelector('[data-modal-text]');
  if (!modal || !content) return;
  content.textContent = text;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  modal.querySelector('[data-modal-close]')?.focus();
}

function closeModal() {
  const modal = document.querySelector('[data-modal]');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

window.GN8RUI = { loadSharedUI, renderCards, renderCommands, showModal, closeModal };
