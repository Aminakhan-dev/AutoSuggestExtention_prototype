# SWYM v0.5.2

**Say what you mean.** SWYM is a Chrome extension that reads the rough prompt
you just typed into an AI chat, infers what you *actually* want to accomplish, and
quietly suggests a sharper version — in a small, non-intrusive panel above the
message box. One click (or Ctrl+Enter) to use it, Esc to make it disappear.

Works on **ChatGPT, Claude, Gemini, Perplexity and DeepSeek** — same chip, same
panel, same keys everywhere.

---

## Install (Load unpacked)

1. Download the zip from the releases page (or clone this repo).
2. Unzip it.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** (toggle, top right).
5. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
6. Pin "SWYM" to the toolbar, click its icon → **Open Settings**.

## Configure (one time, free)

**You do NOT need an OpenAI account.** SWYM supports free providers:

| Provider | Cost | Get a key at | Notes |
|---|---|---|---|
| **Google Gemini** (default) | free tier, no credit card | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | `gemini-3.8-flash`, generous limits |
| **Groq** | free tier, no credit card | [console.groq.com/keys](https://console.groq.com/keys) | `openai/gpt-oss-120b`, very fast |
| **OpenRouter** | free models (`:free` ids rotate) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | paste any current free model id |
| **OpenAI** | paid | platform.openai.com | if you already have a key |

Steps:

1. Pick **Google Gemini** in Settings, click the key link, sign in with a Google
   account, **Create API key**, copy it.
2. Paste into SWYM → **Save** → **Test key**.
3. Done. Switch providers/models any time — custom model ids are allowed too.

Your key is stored in `chrome.storage.local` — it stays in your browser and is
only sent to the provider you selected when you trigger a suggestion. No analytics,
no accounts, no servers of ours.

## Use

1. Open any supported site (chatgpt.com, claude.ai, gemini.google.com,
   perplexity.ai, chat.deepseek.com) and type a rough, messy prompt (8+ characters).
2. A small **Improve** chip appears, centered above the message box.

Four ways to trigger a suggestion — no hotkey needed:

- **Pause while typing** — auto-suggest pops up on its own ~1.2s after you stop (toggle in Settings)
- **Tab** inside the message box
- Click the **Improve** chip above the message box
- **Alt+Shift+I** (always works)

> The card is a **live companion**: while it is open it keeps
> re-writing as your draft evolves — every pause (≥1.2s, so it adapts to your
> typing speed) produces a fresh suggestion, with a small 4s floor between API
> calls so free-tier limits are respected. The preview line shows "Updating…"
> during a refresh and your chosen expansion state is preserved. Close the
> card with **X** or **Esc** and it politely snoozes for 45s; any manual
> trigger (chip / Tab / Alt+Shift+I) wakes it instantly. Clearing the draft
> clears the card. Ctrl+Enter only applies when the draft hasn't moved on
> since the result was built — typing is never hijacked.

3. The panel is a **slim one-line card** by default — sparkle + a one-line preview + expand arrow + close. Click the arrow (or the card) to expand the full view:
   - **You seem to want** — one line describing your inferred intent
   - **Full suggestion text**
   - **Length picker** — **Concise** (super short) / **Balanced** / **Detailed** (long, descriptive); click one to re-rewrite the same draft, the choice sticks for the session
   - **Variant chips** — 2 alternative readings of what you meant
   - **Use** / **Copy** buttons
4. **Use** (or Ctrl+Enter) replaces your draft in the box. **Esc** blurs the box / closes the card, the **X** closes it.
5. Keyboard, while the card shows a fresh result: **1 / 2 / 3** switch variants, **C** copies. (Keys disarm the moment you resume typing, so your draft is never hijacked.)

### Try it with

> `write me email to boss about leaving early tomorrow`

SWYM should infer you want a professional, approval-seeking email and rewrite
the prompt accordingly — with variants for different readings (formal request vs
quick FYI, etc.).

## Privacy

- Your draft text is sent to your chosen provider (with your key) only when you trigger a suggestion.
- No analytics, no accounts, no servers of ours. The extension only talks to the
  API endpoint of the provider you picked (Gemini / Groq / OpenRouter / OpenAI).
- Full policy: [PRIVACY.md](PRIVACY.md).

## Publishing & distribution

- **On your own website** — host the zip (or link GitHub Releases) with the
  4-step install above. Chrome requires either the Web Store or developer
  mode, so "Load unpacked" is the path for direct downloads.
- **Chrome Web Store** — yes, this can be published. Registration is a one-time
  $5 fee; the listing copy, permission justifications, privacy disclosures and
  screenshot checklist are pre-written in [STORE_LISTING.md](STORE_LISTING.md).
  A privacy policy URL (host PRIVACY.md) is required by the review process.
- The codebase is MV3-compliant: no remote code, bundled JS only, minimal
  permissions (`storage` + four provider API hosts).

## Troubleshooting

- **Chip never appears** — reload the chat tab after loading the extension;
  make sure you've typed at least 8 characters. On any supported site, click
  inside the message box once — SWYM trusts your focus over everything else.
- **Auto-suggest or Tab never fires** — first, reload the extension AND refresh
  the chat tab (content scripts do not hot-swap). Then open DevTools → Console
  on the chat tab, enable **Verbose** level, and type + pause: you should see
  `[SWYM vX] auto gate: …` lines explaining the decision (short / unchanged /
  cooldown / backoff), and `[SWYM vX] auto-suggest: pause detected` when it
  fires. No lines at all = the tab is running a stale build — refresh it.
- **"No API key set"** — toolbar icon → Open Settings → pick a free provider, save a key.
- **Provider error 429** — you hit the free-tier rate limit; wait a bit or switch provider.
  Both the Test button and Improve now treat 429 as *key is valid, just busy*.
- **503 / "high demand"** — the provider is overloaded, your key and model are fine.
  The Test button retries once automatically and says so instead of reporting a failure
  of your setup; Improve retries once after ~2s.
- **"model … is no longer available" (404)** — model ids retire over time. SWYM
  auto-fixes this: it tries the replacement model named in the provider's
  own error message, then verifies candidates from the live model list one by one before
  switching. No manual action needed; if all roads fail the error shows exactly what the
  auto-fix attempted under `[auto-fix tried: …]`.
- **ChatGPT updated its DOM** — the script falls back to a scored generic
  editable-box finder (known ids/classes: `#prompt-textarea`, `#chat-input`,
  `.ProseMirror`, `.ql-editor`, `role=textbox`, textareas, contenteditables),
  so renames are usually absorbed. If discovery truly fails, press Alt+Shift+I
  and the pill + console report names the exact suspect element.
- **Extension console** — `chrome://extensions` → SWYM → *service worker* /
  *Inspect views* for logs.

## Roadmap ideas (from the v0 discussion)

- Auto-refresh selector map for chat-site DOM changes; more robust fallbacks
- More AI chat surfaces (Mistral Le Chat, Poe, xAI) — same pattern, per-site adapter
- Tone picker dimension (polite / casual / direct) on top of the length picker
- Human-to-human DMs (WhatsApp Web, Telegram Web) — different tone profile, privacy-first
- Local-model mode (Chrome's built-in Rewriter API) for zero-data-leaving rewriting
- Suggestion history in the popup; accept/reject logging to build a personal "how you talk" model (the moat)

## Status

v0.5.2 (multi-site: ChatGPT / Claude / Gemini / Perplexity / DeepSeek —
multi-provider: Gemini / Groq / OpenRouter / OpenAI, free tiers supported).
v0.5.1 hardened the keyboard apply path for ProseMirror composers (Claude):
editor readback normalizes zero-width markers and CRLF before matching, editor
writes are verified with one paste retry, and apply targets are re-discovered
live. v0.5.2 is the SWYM rebrand — same engine, new name. Distributed as a
direct download / Load unpacked; Chrome Web Store submission kit ready in
STORE_LISTING.md. API key is BYO.
