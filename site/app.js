/* eslint-env browser */
(() => {
  const buttons = Array.from(document.querySelectorAll('[data-mode]'));
  const panels = Array.from(document.querySelectorAll('.mode-panel'));

  function selectMode(mode) {
    buttons.forEach(button => {
      const selected = button.dataset.mode === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    panels.forEach(panel => {
      panel.hidden = panel.id !== `mode-${mode}`;
    });
  }

  if (buttons.length === 2 && panels.length === 2) {
    buttons.forEach(button => {
      button.addEventListener('click', () => selectMode(button.dataset.mode));
    });
    document.documentElement.classList.add('js-modes');
    selectMode('autonome');
  }

  document.querySelectorAll('[data-copy]').forEach(button => {
    const code = document.getElementById(button.dataset.copy);
    const status = document.getElementById('copy-status');
    if (!code || !status) return;
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        status.textContent =
          'Exemple copié. Remplacez l’adresse et le jeton avant de l’utiliser.';
      } catch {
        status.textContent =
          'Copie indisponible : sélectionnez et copiez le texte de l’exemple.';
      }
    });
  });
})();
