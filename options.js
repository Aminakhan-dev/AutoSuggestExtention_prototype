/* Subtext — options page logic */

const $ = (id) => document.getElementById(id);
const PRESET_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'];
const DEFAULT_MODEL = 'gpt-4o-mini';

function setStatus(text, cls) {
  const s = $('status');
  s.textContent = text;
  s.className = cls || '';
}

function syncCustomWrap() {
  const isCustom = $('model').value === 'custom';
  $('customWrap').hidden = !isCustom;
}

async function load() {
  const { apiKey = '', model = DEFAULT_MODEL } = await chrome.storage.local.get(['apiKey', 'model']);
  $('apiKey').value = apiKey;

  if (PRESET_MODELS.includes(model)) {
    $('model').value = model;
  } else if (model) {
    $('model').value = 'custom';
    $('customModel').value = model;
  } else {
    $('model').value = DEFAULT_MODEL;
  }
  syncCustomWrap();
}

async function save() {
  const key = $('apiKey').value.trim();
  let model = $('model').value;
  if (model === 'custom') {
    model = $('customModel').value.trim() || DEFAULT_MODEL;
  }
  await chrome.storage.local.set({ apiKey: key, model: model });
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

$('model').addEventListener('change', syncCustomWrap);
$('save').addEventListener('click', () => { save().catch((e) => setStatus('Save failed: ' + e, 'bad')); });
$('test').addEventListener('click', () => { testKey().catch((e) => setStatus('Test failed: ' + e, 'bad')); });

load();
