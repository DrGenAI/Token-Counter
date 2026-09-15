/* Token Counter for ChatGPT — UI and counting.
 *
 * Runs in the isolated world. Receives data from src/inject.js via CustomEvents
 * and never touches the network itself.
 */
(() => {
  'use strict';

  const T = window.GTCTokenizer;
  if (!T || typeof T.encode !== 'function') {
    console.warn('[Token Counter] tokenizer failed to load');
    return;
  }

  /* ----------------------------------------------------------- settings -- */

  // ChatGPT does not publish a stable per-model context figure, so this is a
  // starting point you can change in the popup rather than a claim.
  const DEFAULTS = {
    contextLimit: 128000,
    showBar: true,
    showUsage: true,
    showCache: true,
    debug: false
  };
  let settings = { ...DEFAULTS };

  // Declared before the storage read: the callback can fire synchronously.
  function log(...a) { if (settings.debug) console.log('[Token Counter]', ...a); }

  // Deferred: in some browsers the storage callback fires before the rest of
  // this file has finished evaluating.
  function scheduleRender() { setTimeout(() => render(), 0); }

  chrome.storage.sync.get(DEFAULTS, (v) => {
    settings = { ...DEFAULTS, ...v };
    scheduleRender();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    scheduleRender();
  });

  /* ------------------------------------------------------------ state ---- */

  const PER_MESSAGE_OVERHEAD = 3; // role + delimiter framing, approximate
  const tokenCache = new Map();   // message id -> token count

  let badge = null;   // header host, declared early so an early render is safe
  let strip = null;   // composer host

  const state = {
    convId: null,
    model: null,
    messages: [],        // {id, role, text, tokens}
    baseTokens: 0,
    pendingUser: '',
    streaming: '',
    cache: null,         // {expiresAt} only when the page actually told us
    usage: null,         // [{label, percent, resetsInSeconds, windowSeconds}]
    usageBusy: false     // a manual refresh is in flight
  };

  function countText(text) {
    if (!text) return 0;
    try { return T.encode(text).length; } catch (_) { return Math.ceil(text.length / 4); }
  }

  function countMessage(id, text) {
    if (id && tokenCache.has(id)) return tokenCache.get(id);
    const n = countText(text) + PER_MESSAGE_OVERHEAD;
    if (id) tokenCache.set(id, n);
    return n;
  }

  function partsToText(content) {
    if (!content) return '';
    const parts = content.parts;
    if (Array.isArray(parts)) {
      return parts
        .map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n');
    }
    if (typeof content.text === 'string') return content.text;
    return '';
  }

  // Walk the active branch only: current_node up through parents. Sibling
  // branches from edits and regenerations are not in context.
  function ingestConversation(id, data) {
    if (!data || !data.mapping) return;
    const chain = [];
    let node = data.mapping[data.current_node];
    let guard = 0;
    while (node && guard++ < 5000) {
      const m = node.message;
      if (m && m.author && m.content) {
        const role = m.author.role;
        const text = partsToText(m.content);
        if (text && role !== 'system') chain.push({ id: m.id, role, text });
      }
      node = node.parent ? data.mapping[node.parent] : null;
    }
    chain.reverse();

    state.convId = id;
    state.model = data.default_model_slug || state.model;
    state.messages = chain.map((m) => ({ ...m, tokens: countMessage(m.id, m.text) }));
    state.baseTokens = state.messages.reduce((a, m) => a + m.tokens, 0);
    state.pendingUser = '';
    state.streaming = '';
    log('conversation', id, state.baseTokens, 'tokens', state.messages.length, 'messages');
    render();
  }

  const liveTotal = () =>
    state.baseTokens +
    (state.pendingUser ? countText(state.pendingUser) + PER_MESSAGE_OVERHEAD : 0) +
    (state.streaming ? countText(state.streaming) + PER_MESSAGE_OVERHEAD : 0);

  /* ------------------------------------------------------------ bridge --- */

  let reqId = 0;
  const pending = new Map();
  function request(path) {
    return new Promise((resolve) => {
      const id = 'r' + ++reqId;
      pending.set(id, resolve);
      window.dispatchEvent(new CustomEvent('gtc:request', { detail: { id, path } }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 8000);
    });
  }
  window.addEventListener('gtc:response', (e) => {
    const d = e.detail || {};
    const r = pending.get(d.id);
    if (r) { pending.delete(d.id); r(d); }
  });

  /* ------------------------------------------------------------ events --- */

  window.addEventListener('gtc:conversation', (e) => {
    const { id, data } = e.detail || {};
    ingestConversation(id, data);
  });

  window.addEventListener('gtc:user-message', (e) => {
    state.pendingUser = (e.detail && e.detail.text) || '';
    if (e.detail && e.detail.model) state.model = e.detail.model;
    render();
  });

  let rafPending = false;
  window.addEventListener('gtc:stream-text', (e) => {
    state.streaming = (e.detail && e.detail.text) || '';
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; render(); });
    }
  });

  window.addEventListener('gtc:stream-done', () => {
    // Fold the finished turn into the base so the next delta starts clean.
    if (state.pendingUser) {
      state.messages.push({ id: null, role: 'user', text: state.pendingUser, tokens: countText(state.pendingUser) + PER_MESSAGE_OVERHEAD });
    }
    if (state.streaming) {
      state.messages.push({ id: null, role: 'assistant', text: state.streaming, tokens: countText(state.streaming) + PER_MESSAGE_OVERHEAD });
    }
    state.baseTokens = state.messages.reduce((a, m) => a + m.tokens, 0);
    state.pendingUser = '';
    state.streaming = '';
    log('turn folded, conversation now', state.baseTokens, 'tokens');
    render();
  });

  window.addEventListener('gtc:probe', (e) => {
    const hits = (e.detail && e.detail.hits) || [];
    if (settings.debug && hits.length) console.table(hits);
    // Only show a cache timer if the page genuinely handed us an expiry.
    for (const h of hits) {
      if (/cache/i.test(h.path) && /expires|ttl|until|deadline/i.test(h.path)) {
        const v = Number(h.value);
        if (Number.isFinite(v) && v > 0) {
          state.cache = { expiresAt: v > 1e11 ? v : v < 1e6 ? Date.now() + v * 1000 : v * 1000 };
          render();
        }
      }
    }
  });

  window.addEventListener('gtc:navigate', () => setTimeout(render, 300));

  /* ------------------------------------------------------------- usage --- */

  // Tolerant extractor: finds any object that carries both a percentage-ish
  // field and a reset-ish field, which is the shape every OpenAI limit payload
  // has used so far.
  function extractWindows(obj, out = [], path = '', depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 5) return out;
    const keys = Object.keys(obj);
    const pctKey = keys.find((k) => /used_percent|percent|utilization|usage_ratio/i.test(k) && typeof obj[k] === 'number');
    const resetKey = keys.find((k) => /resets_in_seconds|reset_after|seconds_until_reset|resets_at|reset_time/i.test(k) && typeof obj[k] === 'number');
    if (pctKey) {
      let pct = obj[pctKey];
      if (pct <= 1) pct *= 100;
      let resets = null;
      if (resetKey) {
        const v = obj[resetKey];
        resets = /at|time/i.test(resetKey) ? Math.max(0, v * (v > 1e11 ? 0.001 : 1) - Date.now() / 1000) : v;
      }
      const win = Number(obj.window_size_seconds || obj.window_seconds || obj.window_minutes * 60 || 0);
      const label = labelFor(path, win);
      out.push({
        label,
        percent: Math.min(100, pct),
        resetsInSeconds: resets,
        windowSeconds: win || inferWindow(label)
      });
    }
    for (const k of keys) if (obj[k] && typeof obj[k] === 'object') extractWindows(obj[k], out, path ? path + '.' + k : k, depth + 1);
    return out;
  }

  // Some payloads name the window but omit its length. These are the standard
  // OpenAI windows; used only to place the pace marker, never to fake a number.
  function inferWindow(label) {
    if (/week/i.test(label)) return 604800;
    if (/session/i.test(label)) return 18000;
    if (/hour/i.test(label)) return 3600;
    const h = /^(\d+)h$/.exec(label);
    return h ? Number(h[1]) * 3600 : 0;
  }

  function labelFor(path, windowSeconds) {
    if (windowSeconds >= 500000) return 'Weekly';
    if (windowSeconds > 0) return Math.round(windowSeconds / 3600) + 'h';
    if (/secondary|weekly|week/i.test(path)) return 'Weekly';
    if (/primary|session|hourly/i.test(path)) return 'Session';
    return path.split('.').pop() || 'Usage';
  }

  async function refreshUsage() {
    if (!settings.showUsage) { state.usage = null; return render(); }
    const paths = await new Promise((resolve) => {
      const h = (e) => { window.removeEventListener('gtc:usage-candidates-result', h); resolve((e.detail && e.detail.paths) || []); };
      window.addEventListener('gtc:usage-candidates-result', h);
      window.dispatchEvent(new CustomEvent('gtc:usage-candidates'));
      setTimeout(() => { window.removeEventListener('gtc:usage-candidates-result', h); resolve([]); }, 3000);
    });
    for (const p of paths) {
      const r = await request(p);
      if (!r || !r.ok || !r.data) { log('usage miss', p, r && r.status); continue; }
      const windows = extractWindows(r.data).slice(0, 2);
      log('usage hit', p, windows);
      if (windows.length) { state.usage = windows; return render(); }
    }
    // Nothing usable. Since August 2026 plain text chat has no session cap, so
    // an empty result here is the expected outcome, not a failure.
    state.usage = null;
    log('no usage windows exposed; hiding the bars');
    render();
  }

  async function manualRefresh() {
    if (state.usageBusy) return;
    state.usageBusy = true;
    render();
    try {
      await refreshUsage();
      state.convId = null;   // let the DOM pass recount from what is on screen
      domSync();
    } finally {
      state.usageBusy = false;
      render();
    }
  }

  /* ---------------------------------------------------------------- ui --- */

  const CSS = `
  :host { all: initial; }
  .wrap {
    font: 400 12px/1.35 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    color: var(--gtc-dim);
    display: inline-flex; align-items: center; gap: 8px;
    white-space: nowrap;
  }
  .sep { opacity: .35; }
  .count { color: var(--gtc-fg); font-variant-numeric: tabular-nums; }
  .meter b { font-weight: 500; color: var(--gtc-fg); }
  .bar {
    width: 64px; height: 5px; border-radius: 3px;
    background: var(--gtc-track); display: inline-block;
    vertical-align: middle; position: relative;
  }
  .bar > i {
    display: block; height: 100%; border-radius: 3px;
    background: var(--gtc-accent); transition: width .25s ease;
  }
  /* Pace marker: how far through the rolling window you are right now. */
  .bar > u {
    position: absolute; top: -2px; bottom: -2px; width: 2px;
    background: var(--gtc-mark); border-radius: 1px;
    transform: translateX(-1px);
  }
  .warn > i { background: var(--gtc-amber); }
  .crit > i { background: var(--gtc-red); }
  button.link {
    all: unset; cursor: pointer; color: var(--gtc-dim);
    border-bottom: 1px solid transparent; padding-bottom: 1px;
  }
  button.link:hover { color: var(--gtc-fg); border-bottom-color: var(--gtc-track); }
  button.link:focus-visible { outline: 2px solid var(--gtc-accent); outline-offset: 2px; border-radius: 2px; }

  .strip {
    display: flex; align-items: center; gap: 18px;
    padding: 7px 16px 8px; margin-top: 2px;
    border-top: 1px solid var(--gtc-track);
    font: 400 12px/1.3 ui-sans-serif, system-ui, sans-serif;
    color: var(--gtc-dim);
  }
  .meter { display: flex; align-items: center; gap: 8px; flex: 1 1 0; min-width: 0; }
  .meter.right { flex-direction: row-reverse; }
  .strip .bar { flex: 1 1 auto; width: auto; min-width: 60px; height: 6px; }
  .meter > span { white-space: nowrap; }
  .refresh {
    all: unset; cursor: pointer; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 4px; color: var(--gtc-dim);
  }
  .refresh:hover { color: var(--gtc-fg); background: var(--gtc-track); }
  .refresh:focus-visible { outline: 2px solid var(--gtc-accent); outline-offset: 1px; }
  .refresh[disabled] { cursor: default; opacity: .6; }
  .refresh svg { width: 13px; height: 13px; }
  .refresh.busy svg { animation: gtc-spin .7s linear infinite; }
  @keyframes gtc-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .refresh.busy svg { animation: none; } }
  @media (prefers-reduced-motion: reduce) { .bar > i { transition: none; } }
  `;

  function themeVars(el) {
    const dark = document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    el.style.setProperty('--gtc-fg', dark ? '#ececf1' : '#2d333a');
    el.style.setProperty('--gtc-dim', dark ? '#9a9aa5' : '#6e7178');
    el.style.setProperty('--gtc-track', dark ? '#3a3a42' : '#dcdee3');
    el.style.setProperty('--gtc-accent', dark ? '#8e8ea0' : '#9a9ba5');
    el.style.setProperty('--gtc-amber', '#d98a2b');
    el.style.setProperty('--gtc-red', '#d9392b');
    el.style.setProperty('--gtc-mark', dark ? '#c8c8d2' : '#4a4d53');
  }

  function makeHost(id) {
    const host = document.createElement('span');
    host.id = id;
    host.dataset.gtc = '1';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const wrap = document.createElement('div');
    root.appendChild(wrap);
    themeVars(host);
    return { host, wrap };
  }

  const HEADER_ANCHORS = [
    '#page-header',
    '[data-testid="conversation-header"]',
    'main header',
    'header'
  ];
  // Elements on the LEFT of the header that the badge should follow.
  const HEADER_LEFT = [
    '[data-testid="breadcrumb"]',
    'nav[aria-label*="readcrumb" i]',
    'header nav',
    'header h1'
  ];
  const COMPOSER_AFTER = [
    '#composer-background',
    'form[data-type="unified-composer"]',
    'main form'
  ];

  // The rounded composer pill, found structurally rather than by class name:
  // walk up from the text input until an ancestor has a real border radius.
  function findComposerBox() {
    const input = document.querySelector(
      '#prompt-textarea, [contenteditable="true"], main textarea'
    );
    let el = input;
    for (let i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const cs = window.getComputedStyle(el);
      const r = parseFloat(cs.borderTopLeftRadius) || 0;
      if (r >= 12 && el.clientWidth > 300) return el;
    }
    return null;
  }

  function firstMatch(list) {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function mountBadge() {
    if (badge && badge.host.isConnected) return true;
    const header = firstMatch(HEADER_ANCHORS);
    if (!header) return false;

    // The breadcrumb, or failing that the leftmost text-bearing child of the
    // header. The action cluster on the right is explicitly excluded.
    let left = null;
    for (const sel of HEADER_LEFT) {
      const el = header.querySelector(sel);
      if (el) { left = el; break; }
    }
    if (!left) {
      const kids = Array.from(header.children);
      left = kids.find((k) => (k.textContent || '').trim() && !/action/i.test(k.id || '')) || kids[0];
    }
    if (!left) return false;

    badge = makeHost('gtc-badge');
    badge.host.style.cssText =
      'display:inline-flex;align-items:center;margin-left:12px;min-width:0;flex:0 0 auto;';
    // Append as the last child of the breadcrumb container. insertBefore on a
    // sibling is at the mercy of how the header orders its children; this is not.
    left.appendChild(badge.host);
    log('badge mounted inside', left.tagName, left.id || left.className,
        '| header children:', Array.from(header.children).map((c) => c.id || c.tagName));
    return true;
  }

  function mountStrip() {
    if (strip && strip.host.isConnected) return true;
    const box = findComposerBox() || firstMatch(COMPOSER_AFTER);
    if (!box) return false;

    strip = makeHost('gtc-strip');
    strip.host.style.cssText = 'display:block;width:100%;flex:1 0 100%;order:99;';

    // Preferred: inside the pill, along its bottom edge.
    box.appendChild(strip.host);

    // The pill may lay its children out in a row, which would crush us into a
    // sliver. Measure, and if that happened, drop back to sitting underneath it.
    const width = strip.host.offsetWidth;
    if (width < 200) {
      strip.host.remove();
      strip.host.style.cssText = 'display:block;width:100%;margin:0 auto;';
      box.insertAdjacentElement('afterend', strip.host);
      log('strip placed under the composer; inside was', width + 'px');
    } else {
      log('strip placed inside the composer,', width + 'px');
    }
    return true;
  }

  const fmtTokens = (n) =>
    n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);

  function fmtDuration(s) {
    if (s == null) return '';
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    if (h) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  // Position in the rolling window, 0 at the start and 100 just before reset.
  function windowElapsed(u) {
    if (!u.windowSeconds || u.resetsInSeconds == null) return null;
    const frac = 1 - u.resetsInSeconds / u.windowSeconds;
    if (!Number.isFinite(frac)) return null;
    return Math.max(0, Math.min(100, frac * 100));
  }

  function severity(pct) {
    return pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : '';
  }

  function renderBadge() {
    if (!mountBadge()) return;
    themeVars(badge.host);
    const total = liveTotal();
    const pct = settings.contextLimit ? Math.min(100, (total / settings.contextLimit) * 100) : 0;
    const w = badge.wrap;
    w.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'wrap';

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = '≈' + fmtTokens(total) + ' tokens';
    count.title = total.toLocaleString() + ' tokens of ' + settings.contextLimit.toLocaleString() +
      ' context (approximate — excludes system prompt, tools and attachments)';
    root.appendChild(count);

    if (settings.showBar && settings.contextLimit) {
      const bar = document.createElement('span');
      bar.className = 'bar ' + severity(pct);
      const fill = document.createElement('i');
      fill.style.width = pct.toFixed(1) + '%';
      bar.appendChild(fill);
      root.appendChild(bar);
    }

    if (settings.showCache && state.cache) {
      const left = (state.cache.expiresAt - Date.now()) / 1000;
      if (left > 0) {
        root.appendChild(sep());
        const c = document.createElement('span');
        c.textContent = 'cached ' + fmtDuration(left);
        root.appendChild(c);
      } else {
        state.cache = null;
      }
    }

    root.appendChild(sep());
    const exp = document.createElement('button');
    exp.className = 'link';
    exp.textContent = 'Export';
    exp.addEventListener('click', exportConversation);
    root.appendChild(exp);

    w.appendChild(root);
  }

  function sep() {
    const s = document.createElement('span');
    s.className = 'sep';
    s.textContent = '·';
    return s;
  }

  function renderStrip() {
    if (!settings.showUsage || !state.usage || !state.usage.length) {
      if (strip && strip.host.isConnected) strip.host.remove();
      return;
    }
    if (!mountStrip()) return;
    themeVars(strip.host);
    const w = strip.wrap;
    w.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'strip';
    state.usage.forEach((u, i) => {
      const m = document.createElement('span');
      m.className = 'meter' + (i === 1 ? ' right' : '');

      const label = document.createElement('span');
      label.append(u.label + ': ');
      const pctEl = document.createElement('b');
      pctEl.textContent = Math.round(u.percent) + '%';
      label.appendChild(pctEl);
      if (u.resetsInSeconds != null) {
        label.append(' \u00b7 resets in ' + fmtDuration(u.resetsInSeconds));
      }

      const bar = document.createElement('span');
      bar.className = 'bar ' + severity(u.percent);
      const fill = document.createElement('i');
      fill.style.width = Math.min(100, u.percent).toFixed(1) + '%';
      bar.appendChild(fill);

      // Elapsed share of the window. Ahead of the fill means you are on pace;
      // behind it means you are spending faster than the window refills.
      const elapsed = windowElapsed(u);
      if (elapsed != null) {
        const mark = document.createElement('u');
        mark.style.left = elapsed.toFixed(1) + '%';
        bar.appendChild(mark);
        bar.title =
          Math.round(u.percent) + '% of the ' + u.label.toLowerCase() +
          ' allowance used, ' + Math.round(elapsed) + '% of the way through the window';
      }

      m.appendChild(label);
      m.appendChild(bar);
      row.appendChild(m);
    });

    const btn = document.createElement('button');
    btn.className = 'refresh' + (state.usageBusy ? ' busy' : '');
    btn.title = state.usageBusy ? 'Refreshing' : 'Refresh usage and token count';
    btn.setAttribute('aria-label', btn.title);
    if (state.usageBusy) btn.setAttribute('disabled', '');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
    btn.addEventListener('click', manualRefresh);
    row.appendChild(btn);
    w.appendChild(row);
  }

  function render() {
    try {
      renderBadge();
      renderStrip();
    } catch (e) {
      log('render failed', e);
    }
  }

  /* ------------------------------------------------------------ export --- */

  function exportConversation() {
    const all = state.messages.slice();
    if (state.pendingUser) all.push({ role: 'user', text: state.pendingUser });
    if (state.streaming) all.push({ role: 'assistant', text: state.streaming });
    const title = (document.title || 'ChatGPT conversation').replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim();
    const head = [
      '# ' + (title || 'ChatGPT conversation'),
      '',
      '- Exported: ' + new Date().toISOString(),
      '- Model: ' + (state.model || 'unknown'),
      '- Approximate tokens: ' + liveTotal().toLocaleString(),
      '',
      '---',
      ''
    ].join('\n');
    const body = all
      .map((m) => '**' + (m.role === 'user' ? 'You' : m.role === 'assistant' ? 'ChatGPT' : m.role) + '**\n\n' + m.text)
      .join('\n\n---\n\n');
    const blob = new Blob([head + body + '\n'], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (title || 'chatgpt-conversation').replace(/[^\w\- ]+/g, '').slice(0, 60).trim().replace(/\s+/g, '-') + '.md';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ------------------------------------------------- DOM fallback count --- */

  // If the conversation JSON never arrives — a project thread, a route we do
  // not recognise, or a page we attached to late — count what is on screen.
  // ChatGPT tags every rendered turn with data-message-author-role.
  function countFromDOM() {
    const nodes = document.querySelectorAll('[data-message-author-role]');
    if (!nodes.length) return null;
    const msgs = [];
    const seen = new Set();
    nodes.forEach((n) => {
      const role = n.getAttribute('data-message-author-role');
      if (role === 'system') return;
      const text = (n.innerText || '').trim();
      if (!text) return;
      const id = n.getAttribute('data-message-id');
      if (id) { if (seen.has(id)) return; seen.add(id); }
      // Key on length too: a streaming node keeps its id while its text grows.
      msgs.push({ id, role, text, tokens: countMessage(id ? id + ':' + text.length : null, text) });
    });
    return msgs;
  }

  function domSync() {
    if (state.streaming || state.pendingUser) return;      // live path owns it
    if (state.convId && state.messages.length) return;     // API data wins
    const msgs = countFromDOM();
    if (!msgs || !msgs.length) return;
    const total = msgs.reduce((a, m) => a + m.tokens, 0);
    if (total === state.baseTokens) return;
    state.messages = msgs;
    state.baseTokens = total;
    log('counted from DOM:', total, 'tokens across', msgs.length, 'messages');
    render();
  }

  /* ------------------------------------------------------------- boot ---- */

  // ChatGPT rebuilds its header and composer constantly; re-mount when they go.
  const obs = new MutationObserver(() => {
    if (!badge || !badge.host.isConnected || (state.usage && (!strip || !strip.host.isConnected))) render();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => { if (state.cache) render(); }, 1000);
  setInterval(domSync, 2000);
  setInterval(refreshUsage, 5 * 60 * 1000);

  // If we land mid-conversation the app may have already fetched the thread
  // before we attached, so ask for it once ourselves.
  setTimeout(async () => {
    render();
    refreshUsage();
    const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    if (m && !state.convId) {
      const r = await request('/backend-api/conversation/' + m[1]);
      if (r && r.ok && r.data) ingestConversation(m[1], r.data);
    }
  }, 800);

  window.addEventListener('gtc:navigate', () => {
    const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    if (!m) {
      state.convId = null; state.messages = []; state.baseTokens = 0;
      state.pendingUser = ''; state.streaming = '';
      render();
    }
  });

  log('ready');
})();
