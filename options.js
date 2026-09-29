/* Subtext — options page logic (multi-provider, free tiers supported) */

const $ = (id) => document.getElementById(id);

// keep in sync with PROVIDERS in background.js
const PROVIDERS = {
  gemini: {
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'],
    defaultModel: 'gemini-3.8-flash',
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

function rebuildModelSelectFromList(models, selectedModel) {
  const sel = $('model');
  sel.innerHTML = '';
  models.forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    sel.appendChild(o);
  });
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom…';
  sel.appendChild(custom);

  if (selectedModel && models.indexOf(selectedModel) !== -1) {
    sel.value = selectedModel;
    $('customWrap').hidden = true;
  } else if (selectedModel) {
    sel.value = 'custom';
    $('customModel').value = selectedModel;
    $('customWrap').hidden = false;
  }
}

async function refreshModels() {
  setStatus('Loading model list from provider…', '');
  const res = await chrome.runtime.sendMessage({ type: 'listModels' });
  if (res && res.ok && res.models && res.models.length) {
    rebuildModelSelectFromList(res.models, res.default || null);
    setStatus('Loaded ' + res.models.length + ' models. Using: ' + res.default, 'ok');
  } else {
    setStatus('Could not load models: ' + ((res && res.error) || 'no response') + ' — check the key is saved first.', 'bad');
  }
}

function syncModelUI(modelId) {
  if (!modelId) return;
  const sel = $('model');
  const hasOption = Array.prototype.some.call(sel.options, (o) => o.value === modelId);
  if (hasOption) {
    sel.value = modelId;
    $('customWrap').hidden = true;
  } else {
    sel.value = 'custom';
    $('customModel').value = modelId;
    $('customWrap').hidden = false;
  }
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
    // background may have auto-switched to a discovered model — reflect it
    if (res.model) {
      await chrome.storage.local.set({ model: res.model });
      syncModelUI(res.model);
    }
    setStatus('Key works.' + (res.model ? ' Using model: ' + res.model : ''), 'ok');
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
$('refreshModels').addEventListener('click', () => { refreshModels().catch((e) => setStatus('Refresh failed: ' + e, 'bad')); });
$('save').addEventListener('click', () => { save().catch((e) => setStatus('Save failed: ' + e, 'bad')); });
$('test').addEventListener('click', () => { testKey().catch((e) => setStatus('Test failed: ' + e, 'bad')); });

load();
