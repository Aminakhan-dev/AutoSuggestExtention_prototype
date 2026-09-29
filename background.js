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
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash']
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 429 = rate-limited, 5xx = provider overloaded: the key is fine and no model
// switch can help — these must never trigger healing nor read as "bad key".
function isBusyStatus(status) {
  return status === 429 || status >= 500;
}

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
  gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'],
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

// Gemini (and others) sometimes retire a model id for new keys and name the
// replacement right inside the error body, e.g.:
//   "This model models/gemini-2.5-flash is no longer available to new users.
//    Please update your code to use models/gemini-3.8-flash"
// Parse that hint out — it is the most reliable heal signal there is.
function suggestModelFromError(text) {
  const t = String(text || '');
  const m = t.match(/use\s+models\/([a-z0-9][a-z0-9._:-]*)/i)
        || t.match(/(?:switch|migrate|fallback)[^."']*?models\/([a-z0-9][a-z0-9._:-]*)/i);
  return m ? m[1].replace(/^models\//, '') : '';
}

// A model id is only "healed" once THIS key proves it works (or at least exists).
// 429 counts as valid: the id exists for this key but is temporarily rate-limited.
async function verifyModel(cfg, apiKey, id) {
  try {
    const res = await tinyChat(cfg, apiKey, id);
    return res.ok || res.status === 429;
  } catch (_) {
    return false;
  }
}

// Rank model ids newest/cheapest first. Order matters: the old code took the
// FIRST flash match in list order, which re-picked retired ids (gemini-2.5-flash
// still appears in the list even for keys that cannot use it).
function modelScore(id, providerKey) {
  const s = String(id);
  if (providerKey === 'gemini') {
    let score = 0;
    if (!/^gemini/i.test(s)) score -= 1000;              // never default to gemma etc.
    const v = s.match(/(\d+)(?:\.(\d+))?/);
    if (v) score += parseInt(v[1], 10) * 100 + (v[2] ? parseInt(v[2], 10) : 0) * 10;
    if (/flash/i.test(s)) score += 50;
    if (/pro/i.test(s)) score -= 10;
    if (/lite/i.test(s)) score -= 20;
    if (/thinking|preview|exp|deprecated|legacy|banned/i.test(s)) score -= 100;
    return score;
  }
  if (providerKey === 'groq') return /gpt-oss-120b/i.test(s) ? 100 : (/120b|70b/i.test(s) ? 50 : 0);
  if (providerKey === 'openrouter') return (/:free$/i.test(s) ? 100 : -100) + (/flash|llama|deepseek|qwen/i.test(s) ? 10 : 0);
  if (providerKey === 'openai') return /gpt-4o-mini/i.test(s) ? 100 : (/mini|small/i.test(s) ? 50 : 0);
  return 0;
}

function rankCandidates(models, providerKey) {
  return models.slice().sort((a, b) => modelScore(b, providerKey) - modelScore(a, providerKey));
}

function pickDefault(models, providerKey) {
  return rankCandidates(models, providerKey)[0] || '';
}

// returns { model, note } — note explains what happened for diagnostics.
// A healed model is always VERIFIED with a real 1-token call before being saved.
async function healModel(failText) {
  const { provider, cfg, apiKey } = await getConfig();
  const notes = [];

  // 1) fastest path: the provider's own error often names the replacement model
  const hinted = suggestModelFromError(failText);
  if (hinted) {
    if (await verifyModel(cfg, apiKey, hinted)) {
      await chrome.storage.local.set({ model: hinted });
      return { model: hinted, note: 'switched to ' + hinted + ' (model suggested by the provider in its error message)' };
    }
    notes.push('provider-suggested ' + hinted + ' did not work either');
  }

  // 2) discover live models from this key, verify top-ranked candidates
  let models = [];
  try {
    models = await listModelsRaw();
  } catch (e) {
    notes.push('model-list failed (' + String((e && e.message) || e) + ')');
  }
  if (models.length) {
    const ranked = rankCandidates(models, provider);
    for (const id of ranked.slice(0, 4)) {
      if (await verifyModel(cfg, apiKey, id)) {
        await chrome.storage.local.set({ model: id });
        return { model: id, note: 'switched to ' + id + ' (verified against the live model list)' };
      }
    }
    notes.push('top-ranked models from the list were all rejected');
  }

  // 3) last resort: brute-force well-known ids
  for (const id of (CANDIDATE_MODELS[provider] || [])) {
    if (await verifyModel(cfg, apiKey, id)) {
      await chrome.storage.local.set({ model: id });
      return { model: id, note: 'switched to ' + id + ' (tested known model ids)' };
    }
  }

  return { model: '', note: notes.join('; ') || 'no usable models discovered' };
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

  // Busy on the first try: the key and model id are proven valid — just retry
  // once after a short pause instead of burning a heal cycle on it.
  if (isBusyStatus(res.status)) {
    await sleep(1500);
    res = await tinyChat(cfg, apiKey, used);
    if (res.ok || res.status === 429) return used;
    if (res.status >= 500) {
      throw new Error(providerConfigLabel(cfg) + ' is overloaded right now (high demand). Your key and model (' + used + ') are fine — try again in a minute.');
    }
  }

  // Remaining failures are model-ish (404) or auth-ish (401/403) — heal only
  // when the error is actually about the model.
  if (!res.ok) {
    const firstDetail = await errDetail(res);
    const modelErr = res.status === 404
      || /no longer available|not found|does not exist|unsupported model|invalid model/i.test(firstDetail);

    if (modelErr) {
      const healed = await healModel(firstDetail);
      if (healed.model) {
        used = healed.model;
        res = await tinyChat(cfg, apiKey, used);
        if (res.ok || res.status === 429) return used; // auto-fix worked
        if (res.status >= 500) {
          // heal succeeded, provider got busy a second later — setup is correct
          throw new Error('Auto-fix switched to ' + used + ' and it verified OK, but ' + providerConfigLabel(cfg) + ' hit high demand right after. Your setup is correct — try again in a minute.');
        }
      }
      const detail = await errDetail(res);
      let msg = providerConfigLabel(cfg) + ' rejected the key (' + res.status + ')' + detail;
      msg += ' [auto-fix tried: ' + (healed.note || 'no alternative model worked') + ']';
      if (res.status === 404 || /no longer available|not found/i.test(detail)) {
        msg += ' - try "Refresh model list" or pick another model in Settings.';
      }
      throw new Error(msg);
    }

    const detail = await errDetail(res);
    throw new Error(providerConfigLabel(cfg) + ' rejected the key (' + res.status + ')' + detail);
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
    const detail = await errDetail(res);

    if (res.status === 429) {
      throw new Error(cfg.label + ' rate limit reached — wait a bit and try again.' + detail.slice(0, 120));
    }
    if (res.status >= 500) {
      if (!noRetry) {
        await sleep(2000);
        return improvePrompt(text, true); // one retry for transient overload
      }
      throw new Error(cfg.label + ' is overloaded right now (high demand). Your key and model are fine — try again in a minute.');
    }

    const modelErr = res.status === 404
      || /no longer available|not found|does not exist|unsupported model|invalid model/i.test(detail);
    if (modelErr && !noRetry) {
      const original = model;
      const healed = await healModel(detail);
      if (healed.model && healed.model !== original) return improvePrompt(text, true);
    }
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
    let j = JSON.parse(text);
    if (Array.isArray(j)) j = j[0]; // some endpoints wrap errors in an array
    const m = j && j.error && (j.error.message || j.error.status);
    if (m) return ': ' + String(m).slice(0, 300);
  } catch (_) {}
  return ': ' + text.slice(0, 200);
}
