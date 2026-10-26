// The extension's settings dialog, opened by the gear in Sleeper's sidebar.
// Pure: the settings -> HTML.
(globalThis.SNP ||= {}).settingsView = (() => {
  const { dialog } = globalThis.SNP.ui;

  // One switch per setting: its key, label and what it changes.
  const OPTIONS = [
    { key: 'nflUi', label: 'NFL tabs and tools', hint: 'Team and Matchup tabs, League cards, Optimize lineup and the Players tab\'s Last 5. Off shows Sleeper\'s own pages.' },
  ];

  function render(values) {
    const rows = OPTIONS.map((o) => `<label class="setting">
        <input type="checkbox" data-setting="${o.key}" ${values[o.key] ? 'checked' : ''}>
        <span><b>${o.label}</b><span class="sub">${o.hint}</span></span>
      </label>`).join('');
    return `<div class="page-layer">${dialog('Sleeper Chrome Extension', 'Settings are saved in this browser.', `<div class="dialog-body">${rows}</div>
      <footer class="dialog-foot settings-foot">
        <button data-action="account">Sleeper account settings</button>
        <button class="primary" data-action="close-modal">Done</button>
      </footer>`)}</div>`;
  }

  return { render, OPTIONS };
})();
