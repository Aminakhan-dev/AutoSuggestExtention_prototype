/* SWYM — popup logic */

const statusEl = document.getElementById('status');
const settingsBtn = document.getElementById('settings');

async function load() {
  const { apiKey = '' } = await chrome.storage.local.get(['apiKey']);
  if (apiKey && apiKey.trim()) {
    statusEl.innerHTML = '<span class="dot on"></span> API key is set. You are good to go.';
    settingsBtn.textContent = 'Open Settings';
  } else {
    statusEl.innerHTML = '<span class="dot off"></span> No key yet — setup takes about a minute.';
    settingsBtn.textContent = 'Set up SWYM (free)';
  }
}

settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
