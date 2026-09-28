/* Subtext — options page logic (multi-provider, free tiers supported) */

const $ = (id) => document.getElementById(id);

// keep in sync with PROVIDERS in background.js
const PROVIDERS = {
  gemini: {
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyNote: 'free, no credit card needed'
  },
  groq: {
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    defaultModel: 'openai/gpt-oss-120b',
    keyUrl: 'https://console.groq.com/keys',
    keyNote: 'free tier, no credit card needed'
  },
  openrouter: {
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyNote: 'free model ids rotate — any :free model works, or type a custom one'
  },
  openai: {
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyNote: 'paid, requires billing'
  }
};

function setStatus(text, cls) {
  const s = $('status');
  s.textContent = text;
  s.className = cls || '';
}

function rebuildModelSelect(providerKey, selectedModel) {
  const cfg = PROVIDERS[providerKey];
  const sel = $('model');
  sel.innerHTML = '';

  cfg.models.forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m + (m === cfg.defaultModel ? '  (default)' : '');
    sel.appendChild(o);
  });
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom…';
  sel.appendChild(custom);

  if (selectedModel && cfg.models.indexOf(selectedModel) !== -1) {
    sel.value = selectedModel;
    $('customWrap').hidden = true;
  } else if (selectedModel && selectedModel !== 'custom') {
    sel.value = 'custom';
    $('customModel').value = selectedModel;
    $('customWrap').hidden = false;
  } else {
    sel.value = cfg.defaultModel;
    $('customWrap').hidden = true;
  }
}

function syncProviderUI() {
  const key = $('provider').value;
  const cfg = PROVIDERS[key];
  $('keyLink').href = cfg.keyUrl;
  $('keyNote').textContent = cfg.keyNote;
}

async function load() {
  const { provider = 'gemini', apiKey = '', model = '' } = await chrome.storage.local.get(['provider', 'apiKey', 'model']);
  $('provider').value = provider;
  $('apiKey').value = apiKey;
  syncProviderUI();
  rebuildModelSelect(provider, model);
}

async function save() {
  const provider = $('provider').value;
  const key = $('apiKey').value.trim();
  let model = $('model').value;
  if (model === 'custom') {
    model = $('customModel').value.trim() || PROVIDERS[provider].defaultModel;
  }
  await chrome.storage.local.set({ provider: provider, apiKey: key, model: model });
  setStatus('Saved.', 'ok');
}

async function testKey() {
  setStatus('Testing…', '');
  const res = await chrome.runtime.sendMessage({ type: 'ping' });
  if (res && res.ok) {
    setStatus('Key works.', 'ok');
  } else {
    setStatus('Failed: ' + ((res && res.error) || 'no response'), 'bad');
  }
}

$('provider').addEventListener('change', () => {
  syncProviderUI();
  // switching providers resets the model to that provider's default
  rebuildModelSelect($('provider').value, null);
});
$('model').addEventListener('change', () => {
  $('customWrap').hidden = $('model').value !== 'custom';
});
$('save').addEventListener('click', () => { save().catch((e) => setStatus('Save failed: ' + e, 'bad')); });
$('test').addEventListener('click', () => { testKey().catch((e) => setStatus('Test failed: ' + e, 'bad')); });

load();
