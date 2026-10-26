// The extension's own settings, saved for the whole browser, and the dialog
// Sleeper's sidebar gear opens for them (settings-view.js draws it); the gear's
// account settings stay one button away.
//   settings() -> { ready, values, onChange(fn), set(patch), attach, destroy }
(globalThis.SNP ||= {}).settings = () => {
  const { settingsView, shared } = globalThis.SNP;
  const KEY = 'settings';
  const DEFAULTS = { nflUi: true };
  const GEAR = '.profile-wrapper .settings-icon';
  const listeners = new Set();
  let values = { ...DEFAULTS };
  let open = false;
  let bypass = false; // the gear's own click, passed on to Sleeper

  const layer = shared.shadowHost('sleeper-settings', render);
  const { host, root } = layer;

  function apply(saved) {
    const next = { ...DEFAULTS, ...saved };
    const changed = Object.keys(next).some((k) => next[k] !== values[k]);
    values = next;
    if (changed) listeners.forEach((fn) => fn(values));
    render();
  }

  const ready = chrome.storage.local.get(KEY).then((saved) => apply(saved[KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) apply(changes[KEY].newValue);
  });

  function set(patch) {
    chrome.storage.local.set({ [KEY]: { ...values, ...patch } });
    apply({ ...values, ...patch });
  }

  function render() {
    if (!layer.styled) return;
    if (!open) return host.remove();
    if (!host.isConnected) document.documentElement.appendChild(host);
    root.innerHTML = settingsView.render(values);
  }

  function close() {
    open = false;
    render();
  }

  root.addEventListener('click', (e) => {
    const action = e.target.closest?.('[data-action]')?.dataset.action;
    if (action === 'close-modal') close();
    if (action === 'account') {
      close();
      bypass = true;
      document.querySelector(GEAR)?.click();
      bypass = false;
    }
  });
  root.addEventListener('change', (e) => {
    const key = e.target.dataset?.setting;
    if (key) set({ [key]: e.target.checked });
  });
  const stops = [
    shared.listen(document, 'keydown', (e) => {
      if (open && e.key === 'Escape') close();
    }),
    // The gear opens this instead of Sleeper's account settings. Capture phase, before Sleeper's own handler.
    shared.listen(document, 'click', (e) => {
      if (bypass || !e.target.closest?.(GEAR)) return;
      e.preventDefault();
      e.stopPropagation();
      open = true;
      render();
    }, true),
  ];

  return { ready, values: () => values, onChange: (fn) => listeners.add(fn), set, destroy: () => stops.forEach((stop) => stop()) };
};
