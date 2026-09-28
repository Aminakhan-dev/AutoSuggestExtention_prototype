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
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
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

  if (msg && msg.type === 'ping') {
    pingKey()
      .then(() => sendResponse({ ok: true }))
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

async function pingKey() {
  const { cfg, apiKey, model } = await getConfig();
  if (!apiKey) throw new Error('No API key set yet.');
  // use a tiny completion instead of GET /models — every provider supports it
  const res = await fetch(cfg.base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      max_tokens: 5
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) {
    const detail = await errDetail(res);
    throw new Error(providerConfigLabel(cfg) + ' rejected the key (' + res.status + ')' + detail);
  }
}

function providerConfigLabel(cfg) {
  for (const k of Object.keys(PROVIDERS)) {
    if (PROVIDERS[k].base === cfg.base) return PROVIDERS[k].label;
  }
  return 'The provider';
}

async function improvePrompt(text) {
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
  try {
    const j = await res.json();
    const m = j && j.error && j.error.message;
    return m ? ': ' + m : '';
  } catch (_) {
    return '';
  }
}
