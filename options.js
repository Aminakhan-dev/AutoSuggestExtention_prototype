/* SWYM — options page logic (multi-provider, free tiers supported) */

const $ = (id) => document.getElementById(id);
// PROVIDERS comes from providers.js (shared with the service worker)

function setStatus(text, cls) {
  const s = $('status');
  s.textContent = text;
  s.className = cls || '';
}

// one builder for both the per-provider defaults and a freshly fetched live list
function fillModelSelect(models, defaultModel, selectedModel) {
  const sel = $('model');
  sel.innerHTML = '';

  models.forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m + (m === defaultModel ? '  (default)' : '');
    sel.appendChild(o);
  });
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom…';
  sel.appendChild(custom);

  if (selectedModel && models.indexOf(selectedModel) !== -1) {
    sel.value = selectedModel;
    $('customWrap').hidden = true;
  } else if (selectedModel && selectedModel !== 'custom') {
    sel.value = 'custom';
    $('customModel').value = selectedModel;
    $('customWrap').hidden = false;
  } else {
    sel.value = defaultModel;
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
  const { provider = 'gemini', apiKey = '', model = '', autoSuggest = true } = await chrome.storage.local.get(['provider', 'apiKey', 'model', 'autoSuggest']);
  $('provider').value = provider;
  $('apiKey').value = apiKey;
  $('autoSuggest').checked = autoSuggest !== false;
  syncProviderUI();
  const cfg = PROVIDERS[provider] || PROVIDERS.gemini;
  fillModelSelect(cfg.models, cfg.defaultModel, model);
}

async function refreshModels() {
  setStatus('Loading model list from provider…', '');
  const res = await chrome.runtime.sendMessage({ type: 'listModels' });
  if (res && res.ok && res.models && res.models.length) {
    fillModelSelect(res.models, res.default || null, res.default || null);
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
  await chrome.storage.local.set({
    provider: provider,
    apiKey: key,
    model: model,
    autoSuggest: !!$('autoSuggest').checked
  });
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
  const cfg = PROVIDERS[$('provider').value];
  fillModelSelect(cfg.models, cfg.defaultModel, null);
});
$('model').addEventListener('change', () => {
  $('customWrap').hidden = $('model').value !== 'custom';
});
$('refreshModels').addEventListener('click', () => { refreshModels().catch((e) => setStatus('Refresh failed: ' + e, 'bad')); });
$('save').addEventListener('click', () => { save().catch((e) => setStatus('Save failed: ' + e, 'bad')); });
$('test').addEventListener('click', () => { testKey().catch((e) => setStatus('Test failed: ' + e, 'bad')); });

load();
