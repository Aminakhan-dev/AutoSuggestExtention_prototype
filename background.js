/*
 * Subtext — background service worker
 * Owns the API key and all LLM traffic so page scripts never touch secrets.
 * Supports free providers (Google Gemini, Groq, OpenRouter) via their
 * OpenAI-compatible endpoints, plus OpenAI itself.
 */

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini (free tier)',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    kind: 'google',
    defaultModel: 'gemini-3.7-flash',
    models: ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash']
  },
  groq: {
    label: 'Groq (free tier)',
    base: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
  },
  openrouter: {
    label: 'OpenRouter (free models)',
    base: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free']
  },
  openai: {
    label: 'OpenAI (paid)',
    base: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini']
  }
};
const DEFAULT_PROVIDER = 'gemini';

function providerConfig(name) {
  return PROVIDERS[name] || PROVIDERS[DEFAULT_PROVIDER];
}

// ---- live model discovery (model ids rot; never trust hardcoded ones) ----

const GEMINI_NATIVE_LIST_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
const BAD_MODEL_RE = /embedding|aqa|imagen|veo|lyria|tts|native-?audio|image|learnlm|live|ComputerUse|robotics/i;

async function listModelsRaw() {
  const { cfg, apiKey } = await getConfig();
  if (!apiKey) throw new Error('No API key set yet.');

  if (cfg.kind === 'google') {
    // attempt 1+2: native list (with and without pageSize — params change over time)
    const attempts = [
      GEMINI_NATIVE_LIST_URL,
      'https://generativelanguage.googleapis.com/v1beta/models'
    ];
    for (const url of attempts) {
      try {
        const res = await fetch(url, {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(20000)
        });
        if (!res.ok) continue;
        const j = await res.json();
        const ids = parseGeminiModels(j);
        if (ids.length) return ids;
      } catch (_) { /* try next */ }
    }
    // attempt 3: OpenAI-compatible surface with Bearer auth
    try {
      const res = await fetch(cfg.base + '/models', {
        headers: { Authorization: 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(20000)
      });
      if (res.ok) {
        const j = await res.json();
        const ids = (j.data || [])
          .map((m) => String(m.id || m.name || ''))
          .filter((id) => id && !BAD_MODEL_RE.test(id));
        if (ids.length) return ids;
      }
    } catch (_) { /* fall through */ }
    return [];
  }

  const res = await fetch(cfg.base + '/models', {
    headers: { Authorization: 'Bearer ' + apiKey },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) {
    const detail = await errDetail(res);
    throw new Error('Could not list models (' + res.status + ')' + detail);
  }
  const j = await res.json();
  return (j.data || [])
    .map((m) => String(m.id || m.name || ''))
    .filter((id) => id && !BAD_MODEL_RE.test(id));
}

function parseGeminiModels(j) {
  return (j && j.models ? j.models : [])
    .map((m) => {
      const name = String(m.name || '').replace(/^models\//, '');
      const methods = m.supportedGenerationMethods || m.supportedActions || null;
      // if the metadata shape changed, keep gemini-like ids instead of filtering everything out
      const allowed = methods
        ? methods.indexOf('generateContent') !== -1
        : /gemini|gemma|learnlm/i.test(name);
      return allowed ? name : '';
    })
    .filter((id) => id && !BAD_MODEL_RE.test(id))
    .filter((id, i, a) => a.indexOf(id) === i);
}

// last-resort candidates, tried directly against chat/completions
const CANDIDATE_MODELS = {
  gemini: ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
  openrouter: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']
};

async function bruteForceModel(cfg, apiKey, providerKey) {
  for (const id of (CANDIDATE_MODELS[providerKey] || [])) {
    try {
      const res = await tinyChat(cfg, apiKey, id);
      if (res.ok) return id;
    } catch (_) { /* keep trying */ }
  }
  return '';
}

// returns { model, note } — note explains what happened for diagnostics
async function healModel() {
  const { provider, cfg, apiKey } = await getConfig();
  let models = [];
  let note = '';
  try {
    models = await listModelsRaw();
  } catch (e) {
    note = 'model-list failed (' + String((e && e.message) || e) + ')';
  }
  let def = models.length ? pickDefault(models, provider) : '';
  if (!def) {
    def = await bruteForceModel(cfg, apiKey, provider);
    if (def) note += (note ? '; ' : '') + 'resolved by testing candidate ids';
  }
  if (!def) return { model: '', note: note || 'no usable models discovered' };
  await chrome.storage.local.set({ model: def });
  return { model: def, note: note };
}

function pickDefault(models, providerKey) {
  const prefs = {
    gemini: [
      (m) => /flash/i.test(m) && !/lite|thinking|preview|exp|pro/i.test(m),
      (m) => /flash/i.test(m) && !/thinking|pro/i.test(m),
      (m) => /gemini/i.test(m) && !/pro/i.test(m)
    ],
    groq: [
      (m) => /gpt-oss-120b/i.test(m),
      (m) => /120b|70b/i.test(m)
    ],
    openrouter: [
      (m) => /:free$/i.test(m) && /flash|llama|deepseek|qwen/i.test(m),
      (m) => /:free$/i.test(m)
    ],
    openai: [
      (m) => /gpt-4o-mini/i.test(m),
      (m) => /mini|small/i.test(m)
    ]
  };
  const chain = prefs[providerKey] || [(m) => !!m];
  for (const test of chain) {
    const hit = models.find(test);
    if (hit) return hit;
  }
  return models[0] || '';
}

async function selfHealModel() {
  const healed = await healModel();
  return healed.model;
}

const SYSTEM_PROMPT = [
  'You are Subtext, an expert prompt engineer and communication coach built into a browser extension. The user typed a rough draft into ChatGPT.',
  '',
  'Your job:',
  '1. Infer what the user is actually trying to accomplish - their real intent and desired outcome - reading between the lines.',
  '2. Rewrite the draft into one clear, specific, well-structured prompt that is likely to produce that outcome. Keep the same language the user wrote in (English draft -> English suggestion, Urdu draft -> Urdu suggestion, etc).',
  '3. Stay faithful: never invent facts, constraints, or goals the user did not imply. If something crucial is ambiguous, pick the most probable reading for the primary suggestion and express other readings in the variants.',
  '4. Match effort to need: expand vague prompts enough to be effective, but do not bloat prompts that are already fine. Keep the user\'s natural voice.',
  '',
  'Return STRICT JSON only, no markdown fences, matching this shape:',
  '{"intent":"<one short plain sentence: what the user actually wants>","primary":"<the improved prompt>","variants":[{"label":"<2-3 words naming a different interpretation>","text":"<improved prompt for that interpretation>"}]}',
  '',
  'Include exactly 2 variants, each assuming a meaningfully DIFFERENT interpretation or goal than the primary.'
].join('\n');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'improve') {
    improvePrompt(msg.text)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // keep the message channel open for the async reply
  }

  if (msg && msg.type === 'listModels') {
    (async () => {
      const models = await listModelsRaw();
      const { provider } = await getConfig();
      const def = pickDefault(models, provider);
      if (def) await chrome.storage.local.set({ model: def });
      return { ok: true, models: models, default: def };
    })()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (msg && msg.type === 'ping') {
    pingKey()
      .then((usedModel) => sendResponse({ ok: true, model: usedModel }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
});

async function getConfig() {
  const { provider, apiKey, model } = await chrome.storage.local.get(['provider', 'apiKey', 'model']);
  const cfg = providerConfig(provider);
  let effectiveModel = (model || '').trim();
  // reset the model if it belongs to another provider's list
  if (!effectiveModel || (cfg.models.indexOf(effectiveModel) === -1 && !cfgAllowCustom(provider))) {
    effectiveModel = cfg.defaultModel;
  }
  return { provider: provider || DEFAULT_PROVIDER, cfg, apiKey: (apiKey || '').trim(), model: effectiveModel };
}

function cfgAllowCustom(providerName) {
  // every provider accepts a custom model id typed by the user
  return true;
}

async function tinyChat(cfg, apiKey, model) {
  return fetch(cfg.base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      max_tokens: 5
    }),
    signal: AbortSignal.timeout(20000)
  });
}

async function pingKey() {
  const { cfg, apiKey, model } = await getConfig();
  if (!apiKey) throw new Error('No API key set yet.');

  let used = model;
  let res = await tinyChat(cfg, apiKey, used);
  let healNote = '';

  // Any failure triggers self-heal: discover live models from the key itself,
  // then brute-force known candidates as a last resort.
  if (!res.ok) {
    const healed = await healModel();
    healNote = healed.note;
    if (healed.model) {
      used = healed.model;
      res = await tinyChat(cfg, apiKey, used);
    }
  }

  if (!res.ok) {
    const detail = await errDetail(res);
    let msg = providerConfigLabel(cfg) + ' rejected the key (' + res.status + ')' + detail;
    if (healNote) msg += ' [auto-fix attempt: ' + healNote + ']';
    if (res.status === 404) msg += ' - try "Refresh model list" or pick another model in Settings.';
    throw new Error(msg);
  }
  return used;
}

function providerConfigLabel(cfg) {
  for (const k of Object.keys(PROVIDERS)) {
    if (PROVIDERS[k].base === cfg.base) return PROVIDERS[k].label;
  }
  return 'The provider';
}

async function improvePrompt(text, noRetry) {
  const { cfg, apiKey, model } = await getConfig();
  if (!apiKey) throw new Error('No API key set. Click the Subtext toolbar icon, then Settings.');
  if (!text || !text.trim()) throw new Error('Nothing to improve - the message box looks empty.');

  let res;
  try {
    res = await fetch(cfg.base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Draft typed by the user:\n"""\n' + text + '\n"""' }
        ]
      }),
      signal: AbortSignal.timeout(45000)
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new Error('Timed out waiting for the model. Try again.');
    throw new Error('Network error talking to ' + cfg.label + ': ' + String((e && e.message) || e));
  }

  if (!res.ok) {
    if (res.status === 404 && !noRetry) {
      const original = model;
      const healed = await healModel();
      if (healed.model && healed.model !== original) return improvePrompt(text, true);
    }
    const detail = await errDetail(res);
    throw new Error(cfg.label + ' error ' + res.status + detail);
  }

  const json = await res.json();
  const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';

  const parsed = extractJson(content);
  if (!parsed || !parsed.primary) throw new Error('Model returned no usable suggestion. Try again.');

  const variants = Array.isArray(parsed.variants)
    ? parsed.variants.slice(0, 2).map((v) => ({
        label: (v && v.label) || 'Variant',
        text: String((v && v.text) || '')
      })).filter((v) => v.text)
    : [];

  return {
    intent: String(parsed.intent || ''),
    primary: String(parsed.primary),
    variants: variants
  };
}

function extractJson(content) {
  try { return JSON.parse(content); } catch (_) {}
  // free-tier models sometimes wrap JSON in fences or chatter — grab the outermost object
  const m = String(content).match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_) {}
  }
  return null;
}

async function errDetail(res) {
  let text = '';
  try { text = await res.text(); } catch (_) { return ''; }
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    const m = j && j.error && (j.error.message || j.error.status);
    if (m) return ': ' + String(m).slice(0, 300);
  } catch (_) {}
  return ': ' + text.slice(0, 200);
}
