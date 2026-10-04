/*
 * Subtext — content script
 * Runs on ChatGPT, Claude, Gemini, Perplexity and DeepSeek.
 * Detects the message box, shows a subtle "Improve" chip, and renders the
 * suggestion panel inside a Shadow DOM so host page styles cannot clash.
 */

(() => {
  'use strict';

  const NAME = 'Subtext';
  // stamped into every pill/console line so the running build is never a mystery
  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? String(chrome.runtime.getManifest().version || '') : '';
  const MIN_CHARS = 8;      // don't offer suggestions on tiny inputs
  const POLL_MS = 700;      // SPA safety net: rediscover editor, refresh chip
  // length styles for suggestions (user-pickable in the panel, v0.3.0)
  const STYLES = [['concise', 'Concise'], ['balanced', 'Balanced'], ['detailed', 'Detailed']];

  const CSS_TEXT = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }

    :host {
      --bg: #ffffff;
      --fg: #111827;
      --muted: #6b7280;
      --line: rgba(17, 24, 39, 0.10);
      --accent: #6366f1;
      --chip-bg: rgba(17, 24, 39, 0.92);
      --shadow: 0 12px 40px rgba(17, 24, 39, 0.18);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #1f2127;
        --fg: #eceef2;
        --muted: #9aa1ad;
        --line: rgba(255, 255, 255, 0.12);
        --chip-bg: rgba(236, 238, 242, 0.95);
      }
    }

    .chip {
      position: fixed;
      transform: translateX(-100%);
      z-index: 2147483600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--chip-bg);
      color: #fff;
      font: 500 12.5px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(17, 24, 39, 0.22);
      opacity: 0.94;
      transition: opacity .15s ease, transform .15s ease;
    }
    @media (prefers-color-scheme: dark) { .chip { color: #111827; } }
    .chip:hover { opacity: 1; transform: translateX(-100%) translateY(-1px); }
    .chip .spark { color: #c7d2fe; }
    @media (prefers-color-scheme: dark) { .chip .spark { color: #4f46e5; } }
    .chip.ok { background: #059669; color: #fff; }

    .chip-spin, .load-spin {
      width: 11px; height: 11px;
      border: 2px solid rgba(255,255,255,.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: subtext-spin .7s linear infinite;
    }
    @keyframes subtext-spin { to { transform: rotate(360deg); } }

    .panel {
      position: fixed;
      z-index: 2147483601;
      width: min(560px, calc(100vw - 24px));
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow);
      font: 400 13.5px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
      padding: 14px 16px 12px;
      animation: subtext-pop .14s ease-out;
    }
    @keyframes subtext-pop {
      from { opacity: 0; transform: translateY(8px) scale(.985); }
      to { opacity: 1; transform: none; }
    }

    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .brand { font-weight: 700; font-size: 13px; letter-spacing: .2px; }
    .beta {
      font-size: 10px; text-transform: uppercase; letter-spacing: .8px;
      color: var(--muted); border: 1px solid var(--line);
      padding: 2px 6px; border-radius: 999px;
    }
    .close {
      margin-left: auto; border: 0; background: transparent; color: var(--muted);
      font: 600 15px/1 system-ui, sans-serif; cursor: pointer; padding: 4px 6px;
      border-radius: 6px;
    }
    .close:hover { color: var(--fg); background: rgba(127,127,127,.12); }

    .err {
      background: rgba(239, 68, 68, .08);
      border: 1px solid rgba(239, 68, 68, .35);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 10px;
    }
    .err-text { color: #b91c1c; font-size: 12.5px; margin-bottom: 8px; }
    @media (prefers-color-scheme: dark) { .err-text { color: #fca5a5; } }
    .err-actions { display: flex; gap: 8px; }

    .loading {
      display: flex; align-items: center; gap: 10px;
      color: var(--muted); font-size: 13px; padding: 14px 0 10px;
    }
    .load-spin { width: 14px; height: 14px; border-color: rgba(99,102,241,.3); border-top-color: var(--accent); }

    .intent-row {
      display: flex; gap: 8px; align-items: baseline;
      border-left: 3px solid var(--accent);
      padding: 4px 0 4px 10px;
      margin-bottom: 10px;
    }
    .intent-label {
      flex: none;
      font-size: 10.5px; text-transform: uppercase; letter-spacing: .8px;
      color: var(--accent); font-weight: 600;
    }
    .intent { color: var(--muted); font-style: italic; font-size: 12.5px; }

    .body {
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 180px;
      overflow-y: auto;
      font-size: 13.5px;
      padding: 2px 0 6px;
    }

    .segs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .seg {
      border: 1px solid var(--line); background: transparent; color: var(--muted);
      font: 500 11.5px/1 system-ui, sans-serif;
      padding: 5px 10px; border-radius: 999px; cursor: pointer;
      max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .seg:hover { color: var(--fg); }
    .seg.active { background: var(--accent); border-color: var(--accent); color: #fff; }

    .styles { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
    .styles-label {
      font-size: 10.5px; text-transform: uppercase; letter-spacing: .8px;
      color: var(--muted); font-weight: 600; margin-right: 2px;
    }
    .kbd-hint {
      margin-top: 8px; color: var(--muted); font-size: 11px; line-height: 1.5;
    }
    .kbd-hint b { font-weight: 600; color: var(--fg); }

    .foot { display: flex; gap: 8px; align-items: center; }
    .btn {
      font: 600 12.5px/1 system-ui, -apple-system, sans-serif;
      border-radius: 10px; padding: 9px 14px; cursor: pointer;
      border: 1px solid transparent;
      transition: filter .12s ease, background .12s ease;
    }
    .btn.primary { background: var(--fg); color: var(--bg); }
    .btn.primary:hover { filter: brightness(1.12); }
    .btn.ghost { background: transparent; border-color: var(--line); color: var(--muted); }
    .btn.ghost:hover { color: var(--fg); }

    .hint {
      position: fixed;
      left: 50%;
      bottom: 96px;
      transform: translateX(-50%);
      z-index: 2147483602;
      background: var(--chip-bg);
      color: #fff;
      font: 500 12.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
      padding: 9px 14px;
      border-radius: 10px;
      box-shadow: 0 6px 18px rgba(17, 24, 39, 0.25);
      max-width: min(480px, calc(100vw - 32px));
      text-align: center;
    }
    @media (prefers-color-scheme: dark) { .hint { color: #111827; } }

    /* our classes set display explicitly (flex/inline-flex), which would beat the
       UA's [hidden] rule and leave ghost rows on screen — force hidden to win */
    [hidden] { display: none !important; }
  `;

  // ---------------- state ----------------
  let host = null;
  let root = null;
  let chip = null;
  let panel = null;
  let ui = {};                 // references inside the panel
  let currentEditor = null;
  let editorMO = null;
  let busy = false;
  let segments = [];           // [{label, text}]
  let activeSeg = 0;
  let chipFlashTimer = null;
  let hintEl = null;
  let hintTimer = null;
  let bootHintShown = false;
  let pollCount = 0;
  let lastDeepScan = 0;
  let lastFocusedEditable = null;  // the box the user last typed/clicked in
  let lastScanReport = [];         // per-candidate scores + rejection reasons
  // auto-suggest state (typing-pause trigger)
  let autoEnabled = true;
  let autoTimer = null;
  let autoLastRun = 0;
  let autoLastText = '';
  let autoFailUntil = 0;       // backoff after an auto attempt failed
  // v0.3.0: length style (sticky for the page session) + keyboard armed-state
  let currentStyle = 'balanced';
  let resultForText = '';      // draft text the current panel result was built from
  const AUTO_DEBOUNCE_MS = 1200;   // v0.3.0: snappier (was 1800)
  const AUTO_COOLDOWN_MS = 25000;
  const AUTO_FAIL_BACKOFF_MS = 90000;
  const boundEditors = new WeakSet();

  const EDITABLE_SEL = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]';

  // ---------------- utils ----------------
  function clampNum(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError; // swallow "context invalidated" etc.
          resolve(res || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  // The box the user is actually typing in is the best signal we can have —
  // it survives every class/id rename ChatGPT will ever ship.
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t || !t.tagName) return;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || t.isContentEditable) {
      lastFocusedEditable = t;
    }
  }, true);

  function deepActiveElement() {
    let a = document.activeElement;
    let hops = 0;
    while (a && a.shadowRoot && a.shadowRoot.activeElement && hops < 5) {
      a = a.shadowRoot.activeElement;
      hops++;
    }
    return a;
  }

  function isPlausibleEditor(el) {
    if (!el || !el.isConnected) return false;
    try {
      if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
      if (el.tagName === 'INPUT') return !el.disabled && !el.readOnly;
      if (el.isContentEditable) return true;
    } catch (_) { /* keep scanning */ }
    return false;
  }

  // ---------------- auto-suggest (typing pause trigger) ----------------
  // Pure decision gate so it can be unit-tested without a DOM.
  function shouldAutoRun(st) {
    if (!st.enabled) return { ok: false, why: 'off' };
    if (st.busy) return { ok: false, why: 'busy' };
    if (st.now < st.failUntil) return { ok: false, why: 'backoff' };
    if (st.now - st.lastRun < st.cooldownMs) return { ok: false, why: 'cooldown' };
    if (!st.text || st.text.length < st.minChars) return { ok: false, why: 'short' };
    if (st.text === st.lastText) return { ok: false, why: 'unchanged' };
    return { ok: true, why: 'go' };
  }

  function scheduleAuto() {
    if (!autoEnabled) return;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(maybeAutoSuggest, AUTO_DEBOUNCE_MS);
  }

  function maybeAutoSuggest() {
    const text = currentEditor && currentEditor.isConnected ? getText(currentEditor) : '';
    const gate = shouldAutoRun({
      enabled: autoEnabled,
      busy: busy,
      now: Date.now(),
      failUntil: autoFailUntil,
      lastRun: autoLastRun,
      cooldownMs: AUTO_COOLDOWN_MS,
      text: text,
      lastText: autoLastText,
      minChars: MIN_CHARS
    });
    if (!gate.ok) return;
    autoLastRun = Date.now();
    autoLastText = text;
    trigger(true);
  }

  // settings: read once at boot, then follow live changes from the options page
  try {
    chrome.storage.local.get(['autoSuggest'], (r) => {
      autoEnabled = !(r && r.autoSuggest === false);
    });
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.autoSuggest) autoEnabled = changes.autoSuggest.newValue !== false;
      });
    }
  } catch (_) {}

  // ---------------- editor discovery ----------------
  // ChatGPT has shipped many composer shapes (textarea, ProseMirror div,
  // plaintext-only editables, role=textbox). Walk priority selectors, and
  // every ~2.5s also pierce open shadow roots in case the composer is one.
  function allRoots() {
    const roots = [document];
    const stack = [document];
    try {
      while (stack.length) {
        const r = stack.pop();
        let els;
        try { els = r.querySelectorAll('*'); } catch (_) { continue; }
        for (const el of els) {
          if (el.shadowRoot) { roots.push(el.shadowRoot); stack.push(el.shadowRoot); }
        }
      }
    } catch (_) { /* ignore */ }
    return roots;
  }

  function composerStats() {
    return {
      prompt: document.querySelectorAll('#prompt-textarea').length,
      editable: document.querySelectorAll(EDITABLE_SEL).length,
      textbox: document.querySelectorAll('[role="textbox"]').length,
      iframes: document.querySelectorAll('iframe').length
    };
  }

  const CANDIDATE_SELS = [
    '#prompt-textarea',
    '#chat-input',
    '.ProseMirror',
    '.ql-editor',
    '[role="textbox"]',
    'textarea',
    '[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]',
    'input[type="text"], input[type="search"], input:not([type])'
  ];

  function candidateElements(roots) {
    const seen = new Set();
    const out = [];
    const push = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };
    for (const rootEl of roots) {
      for (const sel of CANDIDATE_SELS) {
        let nodes;
        try { nodes = rootEl.querySelectorAll(sel); } catch (_) { continue; }
        for (const el of nodes) push(el);
      }
    }
    return out;
  }

  // Score every candidate instead of hard-rejecting. The best one wins;
  // rejected ones keep their reasons so the pill/console can name them.
  function scoreCandidate(el) {
    const reasons = [];
    const id = el.id || '';
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    let cls = '';
    try { cls = String((el.className && el.className.baseVal) || el.className || ''); } catch (_) {}
    const known = id === 'prompt-textarea' || id === 'chat-input' || role === 'textbox'
      || /ProseMirror|ql-editor/i.test(cls);
    let score = 0;

    if (id === 'prompt-textarea') score += 100;
    if (id === 'chat-input') score += 100;
    if (/ProseMirror/i.test(cls)) score += 80;
    if (/ql-editor/i.test(cls)) score += 80;
    if (role === 'textbox') score += 60;

    if (el.tagName === 'TEXTAREA') score += 40;
    else if (el.tagName === 'INPUT') score += 15;
    else if (el.isContentEditable) score += 40;
    else if (!known) { reasons.push('not-editable'); return { el, score: -100, reasons }; }

    // intent signals: what the user is typing in wins over everything
    try {
      const act = deepActiveElement();
      if (el === act) { score += 500; reasons.push('active-element'); }
      else if (el === lastFocusedEditable) { score += 300; reasons.push('last-focused'); }
      else if (act && act.contains && act.contains(el)) { score += 500; reasons.push('inside-active'); }
      else if (el.contains && act && el.contains(act)) { score += 500; reasons.push('contains-active'); }
    } catch (_) {}

    // geometry + visibility
    let r = { width: 0, height: 0, top: 0 };
    try { r = el.getBoundingClientRect(); } catch (_) {}
    let st = null;
    try { st = getComputedStyle(el); } catch (_) {}
    if (!st || st.display === 'none' || st.visibility === 'hidden') {
      score -= 120;
      reasons.push('hidden(' + (st ? st.display + '/' + st.visibility : 'no-style') + ')');
    } else {
      score += 40;
    }

    const w = r.width || 0, h = r.height || 0;
    if (w >= 120 && h >= 20) score += 20;
    const area = w * h;
    if (area > 0) score += Math.min(30, Math.round(Math.log10(area + 1) * 7));
    else { score -= 30; reasons.push('zero-size'); }

    const vh = window.innerHeight || 800;
    if (r.top >= vh * 0.12 && r.top <= vh) score += 10;
    if (r.top < -50 || r.top > vh * 1.5) { score -= 60; reasons.push('offscreen'); }
    try { if (el.closest && el.closest('[aria-hidden="true"]')) { score -= 30; reasons.push('aria-hidden-ancestor'); } } catch (_) {}
    try { if (el.disabled || el.readOnly) { score -= 80; reasons.push('disabled'); } } catch (_) {}

    return {
      el, score, reasons,
      tag: String(el.tagName || '').toLowerCase(),
      id: id.slice(0, 40),
      cls: cls.slice(0, 60),
      w: Math.round(w), h: Math.round(h), top: Math.round(r.top)
    };
  }

  function findEditor() {
    const deep = Date.now() - lastDeepScan > 2500;
    const roots = deep ? allRoots() : [document];
    if (deep) lastDeepScan = Date.now();

    // 0) the box the user clicked/typed in is authoritative — no size or
    //    visibility gate here; their focus IS the intent.
    const act = deepActiveElement();
    if (isPlausibleEditor(act)) return act;
    if (isPlausibleEditor(lastFocusedEditable)) return lastFocusedEditable;

    // 1) otherwise score everything and take the best
    const scored = candidateElements(roots).map(scoreCandidate)
      .sort((a, b) => b.score - a.score);
    lastScanReport = scored;
    const best = scored[0];
    return best && best.score >= 60 ? best.el : null;
  }

  function bindEditor(editor) {
    if (currentEditor === editor) return;
    if (editorMO) { editorMO.disconnect(); editorMO = null; }
    currentEditor = editor;

    if (!editor) {
      refreshChip();
      return;
    }

    if (!boundEditors.has(editor)) {
      editor.addEventListener('input', () => { refreshChip(); scheduleAuto(); });
      editor.addEventListener('focus', () => refreshChip());
      boundEditors.add(editor);
    }

    editorMO = new MutationObserver(() => {
      refreshChip();
      scheduleAuto();
      if (panel && !panel.hidden) positionPanel();
    });
    editorMO.observe(editor, { childList: true, characterData: true, subtree: true });
    refreshChip();
  }

  // ---------------- read / write text ----------------
  function getText(editor) {
    if (!editor) return '';
    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      return String(editor.value || '').trim();
    }
    return (editor.innerText || editor.textContent || '').replace(/\u200B/g, '').trim();
  }

  function setText(editor, text) {
    if (!editor) return;
    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      const proto = editor instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(editor, text);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (editor.isContentEditable) {
      editor.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (_) {
        ok = false;
      }
      if (!ok) pasteFallback(editor, text);
    } else {
      // known composer element that is not editable in this build — best effort
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    autoLastText = text; // don't auto-suggest again for text we just wrote
    refreshChip();
  }

  function pasteFallback(editor, text) {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      editor.dispatchEvent(ev);
    } catch (_) { /* last resort failed; give up quietly */ }
  }

  // ---------------- UI: shadow host ----------------
  function ensureUI() {
    if (host && host.isConnected) return;

    host = document.createElement('div');
    host.id = 'subtext-host';
    root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    root.appendChild(style);

    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.hidden = true;
    chip.title = 'Subtext: suggest a sharper version (Tab or Alt+Shift+I)';
    chip.innerHTML =
      '<svg class="spark" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2z" fill="currentColor"/></svg>' +
      '<span class="chip-label">Improve</span>' +
      '<span class="chip-spin" hidden></span>';
    chip.addEventListener('click', () => {
      if (!panel.hidden) { hidePanel(); return; }
      trigger();
    });
    root.appendChild(chip);

    ui = buildPanel();
    panel = ui.el;
    root.appendChild(panel);

    hintEl = document.createElement('div');
    hintEl.className = 'hint';
    hintEl.hidden = true;
    root.appendChild(hintEl);

    (document.body || document.documentElement).appendChild(host);
  }

  // small feedback pill so no failure is ever silent
  function showHint(msg) {
    ensureUI();
    hintEl.textContent = msg;
    hintEl.hidden = false;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintEl.hidden = true; }, 3600);
  }

  // ---------------- UI: panel ----------------
  function buildPanel() {
    const el = document.createElement('div');
    el.className = 'panel';
    el.hidden = true;

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML =
      '<span class="brand">' + NAME + '</span>' +
      '<span class="beta">prototype</span>' +
      '<button type="button" class="close" title="Close">x</button>';
    el.appendChild(head);

    const err = document.createElement('div');
    err.className = 'err';
    err.hidden = true;
    const errText = document.createElement('div');
    errText.className = 'err-text';
    err.appendChild(errText);
    const errActions = document.createElement('div');
    errActions.className = 'err-actions';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn ghost';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => { hidePanel(); trigger(); });
    const keyBtn = document.createElement('button');
    keyBtn.type = 'button';
    keyBtn.className = 'btn ghost';
    keyBtn.textContent = 'Open Settings';
    keyBtn.addEventListener('click', () => send({ type: 'openOptions' }));
    errActions.appendChild(retryBtn);
    errActions.appendChild(keyBtn);
    err.appendChild(errActions);
    el.appendChild(err);

    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.innerHTML =
      '<span class="load-spin"></span><span>Reading between your lines...</span>';
    el.appendChild(loading);

    const intentRow = document.createElement('div');
    intentRow.className = 'intent-row';
    intentRow.hidden = true;
    intentRow.innerHTML =
      '<span class="intent-label">You seem to want</span>' +
      '<span class="intent"></span>';
    el.appendChild(intentRow);

    // length picker (v0.3.0): Concise / Balanced / Detailed — click re-runs
    // the same draft with a length hint; the choice sticks for the session
    const stylesRow = document.createElement('div');
    stylesRow.className = 'styles';
    stylesRow.hidden = true;
    const stylesLabel = document.createElement('span');
    stylesLabel.className = 'styles-label';
    stylesLabel.textContent = 'Length';
    stylesRow.appendChild(stylesLabel);
    const styleBtns = {};
    STYLES.forEach(([key, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg';
      b.textContent = label;
      b.title = key === 'concise' ? 'Rewrite as a super short, tight prompt'
        : key === 'detailed' ? 'Rewrite as a long, descriptive prompt'
        : 'Default length — matches effort to the draft';
      b.addEventListener('click', () => rerunWithStyle(key));
      styleBtns[key] = b;
      stylesRow.appendChild(b);
    });
    el.appendChild(stylesRow);

    const body = document.createElement('div');
    body.className = 'body';
    el.appendChild(body);

    const segs = document.createElement('div');
    segs.className = 'segs';
    el.appendChild(segs);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'btn primary';
    use.textContent = 'Use this prompt';
    use.addEventListener('click', applyCurrent);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn ghost';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', hidePanel);
    foot.appendChild(use);
    foot.appendChild(dismiss);
    el.appendChild(foot);

    const kbd = document.createElement('div');
    kbd.className = 'kbd-hint';
    kbd.innerHTML = '<b>1</b>/<b>2</b>/<b>3</b> pick variant &nbsp;·&nbsp; <b>C</b> copy &nbsp;·&nbsp; <b>Ctrl+Enter</b> use &nbsp;·&nbsp; <b>Esc</b> close';
    el.appendChild(kbd);

    const closeBtn = head.querySelector('.close');
    closeBtn.addEventListener('click', hidePanel);

    return {
      el: el,
      err: err,
      errText: errText,
      keyBtn: keyBtn,
      loading: loading,
      intentRow: intentRow,
      intent: intentRow.querySelector('.intent'),
      stylesRow: stylesRow,
      styleBtns: styleBtns,
      body: body,
      segs: segs,
      use: use
    };
  }

  function showPanelLoading() {
    ensureUI();
    ui.err.hidden = true;
    ui.loading.hidden = false;
    ui.intentRow.hidden = true;
    ui.stylesRow.hidden = true;
    resultForText = '';            // disarm 1/2/3/C while loading
    ui.body.textContent = '';
    ui.segs.innerHTML = '';
    panel.hidden = false;
    positionPanel();
  }

  function showPanelError(message) {
    panel.hidden = false;
    ui.loading.hidden = true;
    ui.intentRow.hidden = true;
    ui.stylesRow.hidden = true;
    ui.body.textContent = '';
    ui.segs.innerHTML = '';
    ui.errText.textContent = message;
    ui.keyBtn.hidden = !/API key/i.test(message);
    ui.err.hidden = false;
    positionPanel();
  }

  function setActiveSeg(i) {
    if (!segments[i]) return;
    activeSeg = i;
    Array.prototype.forEach.call(ui.segs.children, (c, j) => {
      c.classList.toggle('active', j === i);
    });
    ui.body.textContent = segments[i].text;
    positionPanel();
  }

  function paintStyles() {
    STYLES.forEach(([key]) => {
      const b = ui.styleBtns[key];
      if (b) b.classList.toggle('active', key === currentStyle);
    });
  }

  // re-run the SAME draft with a different length style (Concise/Balanced/Detailed)
  function rerunWithStyle(key) {
    if (busy) return;
    if (currentStyle !== key) {
      currentStyle = key;
      paintStyles();
    }
    runSuggestion(false);
  }

  // pure helper: keyboard '1'/'2'/'3' -> segment index, or null (unit-tested)
  function segIndexForKey(key, segCount) {
    if (!/^[123]$/.test(String(key))) return null;
    const i = parseInt(key, 10) - 1;
    return i < segCount ? i : null;
  }

  function showPanelResult(intentText) {
    panel.hidden = false;
    ui.err.hidden = true;
    ui.loading.hidden = true;
    ui.intentRow.hidden = !intentText;
    ui.intent.textContent = intentText;
    ui.stylesRow.hidden = false;
    paintStyles();

    ui.segs.innerHTML = '';
    segments.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg' + (i === activeSeg ? ' active' : '');
      b.textContent = s.label;
      b.title = s.label;
      b.addEventListener('click', () => setActiveSeg(i));
      ui.segs.appendChild(b);
    });

    ui.body.textContent = segments[activeSeg].text;
    positionPanel();
  }

  function hidePanel() {
    if (!panel) return;
    panel.hidden = true;
    refreshChip();
  }

  function applyCurrent() {
    if (!currentEditor || !segments[activeSeg]) return;
    setText(currentEditor, segments[activeSeg].text);
    hidePanel();
    flashChip('Applied');
  }

  function copyActive() {
    if (!segments[activeSeg]) return;
    const t = segments[activeSeg].text;
    const fail = () => showHint(NAME + ' v' + VERSION + ': could not copy — select the text manually.');
    try {
      navigator.clipboard.writeText(t).then(() => showHint('Copied to clipboard.'), fail);
    } catch (_) { fail(); }
  }

  // ---------------- UI: chip ----------------
  function setChipBusy(on) {
    if (!chip) return;
    chip.classList.toggle('busy', on);
    chip.querySelector('.chip-spin').hidden = !on;
    chip.querySelector('.spark').style.display = on ? 'none' : '';
    chip.querySelector('.chip-label').textContent = on ? 'Thinking' : 'Improve';
  }

  function flashChip(word) {
    if (!chip) return;
    if (chipFlashTimer) clearTimeout(chipFlashTimer);
    chip.classList.add('ok');
    chip.querySelector('.chip-label').textContent = word;
    chipFlashTimer = setTimeout(() => {
      chip.classList.remove('ok');
      chip.querySelector('.chip-label').textContent = 'Improve';
      refreshChip();
    }, 1600);
  }

  function hideChip() {
    if (chip && !busy) chip.hidden = true;
  }

  function refreshChip() {
    if (!chip) return;
    const ed = currentEditor;
    const text = ed && ed.isConnected ? getText(ed) : '';
    const panelOpen = panel && !panel.hidden;
    // chip is the quiet always-on affordance; the panel takes over once open
    const show = !!ed && ed.isConnected && isVisible(ed) && text.length >= MIN_CHARS && !panelOpen;
    chip.hidden = !show;
    if (show) positionChip();
  }

  // ---------------- positioning ----------------
  function positionChip() {
    if (!currentEditor || !currentEditor.isConnected) return;
    const r = currentEditor.getBoundingClientRect();
    if (!r.width && !r.height) return;
    chip.style.left = Math.round(r.right - 6) + 'px';
    chip.style.top = Math.round(Math.max(8, r.top - 40)) + 'px';
  }

  function positionPanel() {
    if (!currentEditor || !currentEditor.isConnected) return;
    const r = currentEditor.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - 572);
    panel.style.left = clampNum(r.left, 12, maxLeft) + 'px';
    panel.style.bottom = Math.round(window.innerHeight - r.top + 10) + 'px';
  }

  function repositionAll() {
    if (!panel || panel.hidden) {
      if (chip && !chip.hidden) positionChip();
      return;
    }
    positionChip();
    positionPanel();
  }

  // ---------------- main flow ----------------
  // discovery + guards; the request itself lives in runSuggestion so the
  // length-picker can re-run the same draft without re-discovering
  async function trigger(auto) {
    if (busy) return;
    // live re-discovery at trigger time — never trust a stale binding
    if (!currentEditor || !currentEditor.isConnected || !isVisible(currentEditor)) {
      const live = findEditor();
      if (live) bindEditor(live);
    }
    if (!currentEditor || !currentEditor.isConnected || !isVisible(currentEditor)) {
      const st = composerStats();
      const any = st.prompt + st.editable + st.textbox;
      let where;
      if (any) {
        const top = (lastScanReport || []).slice(0, 2).map((c) =>
          (c.tag || '?') + (c.id ? '#' + c.id : '') + ' ' + (c.w || 0) + 'x' + (c.h || 0) +
          (c.reasons && c.reasons.length ? ' [' + c.reasons.slice(0, 2).join('; ') + ']' : ' [score ' + c.score + ']')
        ).join('  |  ');
        where = 'Found ' + st.prompt + ' prompt-box / ' + st.editable + ' editable / ' +
          st.textbox + ' textbox / ' + st.iframes + ' iframe elements. Best: ' + (top || 'none scored') +
          '. Press F12 > Console and send the [Subtext] report to the author.';
      } else {
        where = 'No editable message box exists in this page at all. Are you on a chat screen (chatgpt.com, claude.ai, gemini.google.com, perplexity.ai, chat.deepseek.com)?';
      }
      showHint(NAME + ' v' + VERSION + ': message box not found — ' + where);
      try { console.warn('[Subtext v' + VERSION + '] scan report', JSON.stringify(lastScanReport || [], null, 1), 'stats', st, 'ua', navigator.userAgent); } catch (_) {}
      return;
    }
    runSuggestion(!!auto);
  }

  async function runSuggestion(isAuto) {
    if (busy || !currentEditor || !currentEditor.isConnected) return;
    const text = getText(currentEditor);
    if (text.length < MIN_CHARS) {
      showHint(NAME + ' v' + VERSION + ': type a little more first — Improve needs at least ' + MIN_CHARS + ' characters.');
      return;
    }

    busy = true;
    setChipBusy(true);
    chip.hidden = false;
    positionChip();
    showPanelLoading();

    const res = await send({ type: 'improve', text: text, style: currentStyle });
    busy = false;
    setChipBusy(false);

    if (!res) {
      if (isAuto) autoFailUntil = Date.now() + AUTO_FAIL_BACKOFF_MS;
      refreshChip();
      showPanelError('Could not reach the extension background. Reload this page and try again.');
      return;
    }
    if (!res.ok) {
      if (isAuto) autoFailUntil = Date.now() + AUTO_FAIL_BACKOFF_MS;
      refreshChip();
      showPanelError(String(res.error || 'Unknown error.'));
      return;
    }
    autoFailUntil = 0;

    segments = [{ label: 'Primary', text: res.data.primary }].concat(
      (res.data.variants || []).map((v) => ({ label: v.label || 'Variant', text: v.text }))
    );
    activeSeg = 0;
    resultForText = text;   // arm 1/2/3/C until the draft changes
    showPanelResult(res.data.intent || '');
    refreshChip();
  }

  // ---------------- global wiring ----------------
  function onScrollOrResize() {
    requestAnimationFrame(repositionAll);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && !panel.hidden) {
      hidePanel();
      return;
    }
    // Esc with panel closed = leave the composer (escape hatch from Tab capture)
    if (e.key === 'Escape' && currentEditor && currentEditor.isConnected
        && currentEditor.contains && currentEditor.contains(document.activeElement)) {
      try { document.activeElement.blur(); } catch (_) {}
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && panel && !panel.hidden && resultForText) {
      e.preventDefault();
      applyCurrent();
      return;
    }
    // 1/2/3 pick a variant, C copies — armed only while the panel shows a
    // result for the CURRENT draft text, so resumed typing is never hijacked
    if (panel && !panel.hidden && !e.altKey && !e.ctrlKey && !e.metaKey && resultForText
        && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === 'c')) {
      const ed = currentEditor;
      const inEditor = !!(ed && ed.isConnected);
      const draft = inEditor ? getText(ed) : '';
      if (!inEditor || draft === resultForText) {
        if (e.key === 'c') {
          e.preventDefault();
          copyActive();
        } else {
          const idx = segIndexForKey(e.key, segments.length);
          if (idx !== null) {
            e.preventDefault();
            setActiveSeg(idx);
          }
        }
        return;
      }
    }
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyI') {
      e.preventDefault();
      trigger();
      return;
    }
    // Tab inside a composer with enough text = trigger a suggestion
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const ed = currentEditor;
      const ae = document.activeElement;
      if (ed && ed.isConnected && ae && (ae === ed || (ed.contains && ed.contains(ae)))
          && !busy && panel && panel.hidden) {
        if (getText(ed).length >= MIN_CHARS) {
          e.preventDefault();
          e.stopPropagation();
          trigger();
        }
      }
    }
  }, true);

  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);

  const bodyMO = new MutationObserver(() => {
    if (!currentEditor || !currentEditor.isConnected) bindEditor(findEditor());
  });
  bodyMO.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    pollCount++;
    ensureUI();
    if (!currentEditor || !currentEditor.isConnected) bindEditor(findEditor());
    refreshChip();
    // once, ~4s after load: say something if we still have not found an editor
    if (!bootHintShown && pollCount >= 6 && document.visibilityState === 'visible'
        && (!currentEditor || !currentEditor.isConnected)) {
      bootHintShown = true;
      const st = composerStats();
      showHint(NAME + ' v' + VERSION + ' is active but has not found the message box (prompt-box: ' + st.prompt + ' · editable: ' + st.editable + ' · textbox: ' + st.textbox + ' · iframes: ' + st.iframes + '). Click inside the message box once, then press Alt+Shift+I. Refresh the tab if you just reloaded the extension.');
      try { console.warn('[Subtext v' + VERSION + '] boot discovery stats', st); } catch (_) {}
    }
  }, POLL_MS);

  // boot
  ensureUI();
  bindEditor(findEditor());
  refreshChip();
})();
