# Subtext — prototype v0.1.0

**Say what you meant.** Subtext is a Chrome extension that reads the rough prompt
you just typed into ChatGPT, infers what you *actually* want to accomplish, and
quietly suggests a sharper version — in a small, non-intrusive panel above the
message box. One click (or Ctrl+Enter) to use it, Esc to make it disappear.

This is the first prototype, scoped to **chatgpt.com only**, built to validate the
core idea: intent → outcome-driven rewriting, surfaced as a subtle suggestion.

---

## Name brainstorm (why "Subtext" for now)

Working title: **Subtext** — it reads between your lines, and it lives as a subtle
layer on top of the app you're already using. Alternates worth keeping in the drawer:

| Name | Angle / tagline |
|---|---|
| **Subtext** | "it reads between your lines" — overlay + intent inference |
| **Meant** | "Say what you meant." — clean, one word, emotionally exact |
| **Reframe** | every suggestion is a reframe of your message |

Renaming later  change `NAME` in `content.js` and the `name`
fields in `manifest.json`.

---

## Install (Load unpacked)

1. Download or clone this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
5. Pin "Subtext" to the toolbar, click its icon → **Open Settings**.

## Configure (one time)

- Paste an **OpenAI API key** (create one at platform.openai.com → API keys).
- Pick a model. `gpt-4o-mini` is the default: fast, cheap, good enough for v1.
- Click **Save**, then **Test key** to confirm.

Your key is stored in `chrome.storage.local` — it stays in your browser and is
only sent to OpenAI when you trigger a suggestion. Nothing else, nowhere else.

## Use

1. Open [chatgpt.com](https://chatgpt.com) and type a rough, messy prompt (8+ characters).
2. A small **Improve** chip appears above the message box (top-right corner).
3. Click it — or press **Alt+Shift+I**.
4. The panel shows:
   - **You seem to want** — one line describing your inferred intent
   - **Primary** — the improved prompt
   - **Variant chips** — 2 alternative readings of what you meant
5. **Use this prompt** (or Ctrl+Enter) replaces your draft in the box. **Esc** / **Dismiss** closes it.

### Try it with

> `write me email to boss about leaving early tomorrow`

Subtext should infer you want a professional, approval-seeking email and rewrite
the prompt accordingly — with variants for different readings (formal request vs
quick FYI, etc.).

## Privacy

- Your draft text is sent to OpenAI (with your key) only when you click Improve.
- No analytics, no accounts, no servers of ours. The extension talks to nothing
  except `api.openai.com`.

## Troubleshooting

- **Chip never appears** — reload the ChatGPT tab after loading the extension;
  make sure you've typed at least 8 characters.
- **"No API key set"** — toolbar icon → Open Settings → save a key.
- **ChatGPT updated its DOM** — the script falls back to a generic editable-box
  finder, but if OpenAI renames things, the primary selector lives in
  `findEditor()` in `content.js` (`#prompt-textarea`).
- **Extension console** — `chrome://extensions` → Subtext → *service worker* /
  *Inspect views* for logs.

## Roadmap ideas (from the v0 discussion)

- Auto-refresh selector map for ChatGPT DOM changes; more robust fallbacks
- Other AI chat surfaces (Claude, Gemini, Perplexity) — same pattern, per-site adapter
- Human-to-human DMs (WhatsApp Web, Telegram Web) — different tone profile, privacy-first
- Local-model mode (Chrome's built-in Rewriter API) for zero-data-leaving rewriting
- Accept/reject logging to build a personal "how you talk" model (the moat)

## Status

Prototype. Not on the Chrome Web Store — load unpacked only. Rename pending
(decision above), API key is BYO. Built fast to test the core loop; expect
rough edges and tell the extension author everything.
