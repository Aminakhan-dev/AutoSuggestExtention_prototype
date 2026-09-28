/*
 * Subtext — background service worker
 * Owns the API key and all LLM traffic so page scripts never touch secrets.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

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
  const { apiKey, model } = await chrome.storage.local.get(['apiKey', 'model']);
  return { apiKey: (apiKey || '').trim(), model: (model || DEFAULT_MODEL).trim() };
}

async function pingKey() {
  const { apiKey } = await getConfig();
  if (!apiKey) throw new Error('No API key set yet.');
  const res = await fetch(OPENAI_MODELS_URL, {
    headers: { Authorization: 'Bearer ' + apiKey }
  });
  if (!res.ok) {
    const detail = await errDetail(res);
    throw new Error('OpenAI rejected the key (' + res.status + ')' + detail);
  }
}

async function improvePrompt(text) {
  const { apiKey, model } = await getConfig();
  if (!apiKey) throw new Error('No API key set. Click the Subtext toolbar icon, then Settings.');
  if (!text || !text.trim()) throw new Error('Nothing to improve - the message box looks empty.');

  let res;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
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
    if (e && e.name === 'TimeoutError') throw new Error('Timed out waiting for OpenAI. Try again.');
    throw new Error('Network error talking to OpenAI: ' + String((e && e.message) || e));
  }

  if (!res.ok) {
    const detail = await errDetail(res);
    throw new Error('OpenAI error ' + res.status + detail);
  }

  const json = await res.json();
  const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error('Could not parse the model response. Try again.');
  }
  if (!parsed || !parsed.primary) throw new Error('Model returned no suggestion. Try again.');

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

async function errDetail(res) {
  try {
    const j = await res.json();
    const m = j && j.error && j.error.message;
    return m ? ': ' + m : '';
  } catch (_) {
    return '';
  }
}
