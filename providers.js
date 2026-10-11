/*
 * SWYM — provider catalog.
 * Single source of truth shared by the service worker (importScripts) and
 * the options page (<script>). Model ids here are only starting defaults;
 * the background heals stale ids from the provider's live list at runtime.
 */

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini (free tier)',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    kind: 'google',
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'],
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyNote: 'free, no credit card needed'
  },
  groq: {
    label: 'Groq (free tier)',
    base: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    keyUrl: 'https://console.groq.com/keys',
    keyNote: 'free tier, no credit card needed'
  },
  openrouter: {
    label: 'OpenRouter (free models)',
    base: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyNote: 'free model ids rotate — any :free model works, or type a custom one'
  },
  openai: {
    label: 'OpenAI (paid)',
    base: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyNote: 'paid, requires billing'
  }
};

const DEFAULT_PROVIDER = 'gemini';
