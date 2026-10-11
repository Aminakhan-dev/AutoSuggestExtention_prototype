# SWYM — Privacy Policy

Last updated: October 9, 2026

SWYM is a browser extension that helps you rewrite rough drafts typed into AI
chat websites. This policy explains exactly what data the extension handles.
The short version: **SWYM has no backend, no account system, no analytics,
and collects nothing.**

## What data the extension processes

- **Your draft text.** When you trigger a suggestion, the text currently in the
  chat's message box is sent to the AI provider **you** configured (Google
  Gemini, Groq, OpenRouter, or OpenAI), using the API key **you** entered, to
  generate the rewrite. The request goes directly from your browser to that
  provider — it never passes through any server operated by the developer.
- **Your API key and settings.** Stored with `chrome.storage.local`, which is
  sandboxed to your browser profile. It is sent only to the endpoint of the
  provider you selected, as authentication for your own requests.

## What the extension does NOT do

- It does not collect, store remotely, or transmit any data to the developer.
- It has no analytics, telemetry, tracking, advertising, or fingerprinting.
- It does not read or alter the content of the chat pages beyond the message
  box it attaches its suggestion panel to.
- It does not run any remotely hosted code (all JavaScript is packaged in the
  extension itself, per Chrome MV3 requirements).

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Saves your provider choice, API key, model, and settings locally. |
| Host permissions for `api.openai.com`, `generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai` | Lets the background service worker send your draft to the provider you picked. No other hosts are contacted. |
| Content scripts on ChatGPT, Claude, Gemini, Perplexity, DeepSeek | Detects the message box and shows the suggestion panel on those sites. |

## Removing your data

Uninstalling the extension (or clicking **Remove** in `chrome://extensions`)
deletes everything stored locally, including your API key. To revoke an API
key itself, delete it in the provider's dashboard (e.g. Google AI Studio or
the Groq console).

## Contact

Questions about this policy: open an issue on the project's repository or use
the support contact listed on the extension's store listing.
