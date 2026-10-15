/* eslint-env browser */
(() => {
  const buttons = Array.from(document.querySelectorAll('[data-mode]'));
  const panels = Array.from(document.querySelectorAll('.mode-panel'));
  if (buttons.length !== 2 || panels.length !== 2) return;

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

  buttons.forEach(button => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
  });
  document.documentElement.classList.add('js-modes');
  selectMode('autonome');
})();
