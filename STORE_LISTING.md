# Chrome Web Store submission kit (v0.5.2)

Everything below is ready to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
One-time registration fee: **$5 USD**.

## 1. Package

- Upload the extension **zip** (the same `swym-extension-v0.5.2.zip` used for
  website distribution — it must contain `manifest.json` at the zip root).
- If the dashboard flags a version, bump `version` in `manifest.json` and
  re-zip; every upload must have a strictly higher version than the last.

## 2. Listing copy

**Name** (max 45 chars)

> SWYM — say what you mean

**Short description** (max 132 chars)

> Turns your rough draft in ChatGPT, Claude, Gemini, Perplexity or DeepSeek into a sharper prompt. Free providers supported.

**Detailed description**

> Type messy, send sharp.
>
> SWYM watches the message box on the AI chats you already use — ChatGPT,
> Claude, Gemini, Perplexity and DeepSeek. When you pause after typing a rough
> draft, it quietly suggests a sharper, more specific version of your prompt,
> plus two alternative readings of what you might have meant.
>
> - Works automatically: pause while typing and a small card appears above the
>   message box (or press Tab, click the Improve chip, or use Alt+Shift+I)
> - One line by default — expand only when you want the details
> - Keep rewriting: the card updates as your draft evolves
> - Pick a length: Concise, Balanced or Detailed
> - One click "Use" replaces your draft; Copy puts it on your clipboard
> - Keyboard friendly: 1/2/3 switch variants, C copies, Ctrl+Enter accepts,
>   Esc dismisses
>
> Bring your own key — free tiers supported (Google Gemini, Groq, OpenRouter).
> Your key stays in your browser and is sent only to the provider you choose.
> No accounts, no analytics, no servers of ours.

**Category:** Productivity → Tools
**Language:** English

## 3. Single purpose (dashboard field)

> SWYM reads the draft text in the message box of supported AI chat sites
> and suggests an improved version of that prompt, shown in a panel over the
> message box.

## 4. Permission justifications (dashboard fields)

- `storage` — "Stores the user's provider choice, API key, model id and the
  auto-suggest setting locally via chrome.storage.local. Nothing is synced or
  sent anywhere except to the provider the user selected."

- `host_permissions` (api.openai.com, generativelanguage.googleapis.com,
  api.groq.com, openrouter.ai) — "The extension sends the user's draft text,
  with the user's own API key, to the OpenAI-compatible chat-completions
  endpoint of the provider the user selected. These four hosts are exactly the
  endpoints of the supported providers; no other hosts are contacted."

- Content script host permissions (chatgpt.com, claude.ai, gemini.google.com,
  perplexity.ai, chat.deepseek.com) — "The content script detects the message
  box on these AI chat sites and displays SWYM's suggestion panel near it.
  It does not read or modify any other page content."

- Check "Remote code": **No** — all code is bundled; the extension only makes
  fetch calls to the provider endpoints above.

## 5. Privacy tab

- **Privacy policy URL** — required. Host `PRIVACY.md` (rendered, e.g. GitHub
  raw / repo page / your website) and paste the URL.
- Data usage disclosures: select **"Does not collect user data"** is NOT
  accurate — draft text is processed and sent to the user's chosen provider.
  Correctly declare: "Website content" → user-provided text is processed and
  transmitted to a third party (the provider the user configures), but **not**
  collected for the developer's use, not sold, and not used for anything
  unrelated to the single purpose. Do not check the "compliance with privacy
  certification" box unless you actually certify.

## 6. Assets to prepare

- **Icon**: 128×128 PNG (already in `icons/`).
- **Screenshots**: 1–5 images at 1280×800 (or 640×400). Recommended shots:
  1. ChatGPT with the collapsed one-line card above the composer
  2. Expanded card showing intent line + length picker + variants
  3. "Updating…" state while the draft evolves
  4. Settings page with free provider selected
- **Small promo tile** (440×280) — optional but improves the listing.

## 7. Review notes field (recommended paste)

> The extension is a prompt-rewriting helper for AI chat sites. It contains no
> remote code, no analytics, and no backend. The user brings their own API key
> (stored locally) and draft text is sent only to that provider's endpoint when
> the user triggers a suggestion. Test: load any supported site, type 8+
> characters, pause — a suggestion card appears above the message box.

## 8. Realistic expectations

- Review usually takes a few hours to a few days; content-script extensions on
  popular sites sometimes get an extra manual pass.
- First rejection, if any, is almost always about the privacy disclosures
  (step 5) — answer the reviewer via the dashboard "Reply to reviewer" box.
- Until it's published, website distribution (below) is instant.

## 9. Website distribution (no store needed)

Chrome only installs extensions from the Web Store or in developer mode, so:

1. Put the zip (or a GitHub Releases link) on your site: "Download & unzip →
   chrome://extensions → Developer mode → Load unpacked".
2. Copy the exact 4-step install block from the README into the download page.
3. Optional: host on GitHub Releases so each version has a permanent link and
   changelog; point the site button at the latest release asset.
4. Alternative stores that accept the same zip with less friction: **Edge
   Add-ons** (free) and **Firefox** needs a small port — skip unless asked.
