/* Token Counter for ChatGPT — main-world interceptor.
 *
 * Runs in the page's own JS context so it can see the Authorization header the
 * app attaches to /backend-api/* calls. It never sends anything off-origin; it
 * only re-emits what the page already received, as CustomEvents the content
 * script listens for.
 *
 * Endpoints are declared in one place (ENDPOINTS) because OpenAI moves them —
 * the Codex usage route moved from /api/codex/usage to /backend-api/wham/usage
 * in April 2026. When something breaks, this object is the thing to edit.
 */
(() => {
  'use strict';
  if (window.__GTC_INJECTED__) return;
  window.__GTC_INJECTED__ = true;

  const ENDPOINTS = {
    // GET, returns the full message tree for a conversation
    conversationDetail: /\/backend-api\/(?:f\/)?conversation\/([0-9a-f-]{36})(?:\?|$)/i,
    // POST, returns the SSE stream for a new turn
    conversationStream: /\/backend-api\/(?:f\/)?conversation$/i,
    // Anything we should harvest the auth header from
    authScope: /\/backend-api\//i,
    // Candidate usage/limit routes, tried in order by the content script
    usageCandidates: [
      '/backend-api/wham/usage',
      '/backend-api/models?history_and_training_disabled=false',
      '/backend-api/conversation_limit'
    ]
  };

  const emit = (name, detail) => {
    try {
      window.dispatchEvent(new CustomEvent('gtc:' + name, { detail }));
    } catch (_) {}
  };

  /* ---------------------------------------------------------------- auth -- */

  const auth = { token: null, accountId: null };

  function harvestHeaders(input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (!url || !ENDPOINTS.authScope.test(url)) return;
      const h = new Headers(
        (init && init.headers) || (input && input.headers) || {}
      );
      const a = h.get('authorization');
      const acct = h.get('chatgpt-account-id');
      let changed = false;
      if (a && a !== auth.token) { auth.token = a; changed = true; }
      if (acct && acct !== auth.accountId) { auth.accountId = acct; changed = true; }
      if (changed) emit('auth', { hasToken: !!auth.token });
    } catch (_) {}
  }

  /* ------------------------------------------------------- probe helpers -- */

  // Walks an object looking for anything that smells like cache or limit
  // metadata, so we can find out empirically whether ChatGPT exposes it
  // instead of guessing. Reported to the console only in debug mode.
  const PROBE_KEY = /cache|cached|ttl|expires_at|rate_limit|limit|quota|utilization|reset/i;
  function probe(obj, hits = [], path = '', depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6 || hits.length > 40) return hits;
    for (const k of Object.keys(obj)) {
      const p = path ? path + '.' + k : k;
      const v = obj[k];
      if (PROBE_KEY.test(k) && (typeof v !== 'object' || v === null)) {
        hits.push({ path: p, value: v });
      } else if (v && typeof v === 'object') {
        probe(v, hits, p, depth + 1);
      }
    }
    return hits;
  }

  /* ------------------------------------------------------- SSE decoding -- */

  // ChatGPT has shipped at least two stream shapes. Handle both, and ignore
  // anything we do not recognise rather than throwing.
  function makeStreamDecoder() {
    let assistantText = '';
    let lastPath = '';
    let sawCumulative = false;

    const isPartsPath = (p) => typeof p === 'string' && /\/content\/parts\/\d+$/.test(p);

    function applyOp(obj) {
      if (!obj || typeof obj !== 'object') return;

      // Shape A (legacy): full message object, parts[0] is cumulative text.
      const msg = obj.message || (obj.v && obj.v.message);
      if (msg && msg.author && msg.author.role === 'assistant') {
        const parts = msg.content && msg.content.parts;
        if (Array.isArray(parts) && typeof parts[0] === 'string') {
          assistantText = parts.map((x) => (typeof x === 'string' ? x : '')).join('');
          sawCumulative = true;
          return;
        }
      }

      // Shape B (delta encoding): {p, o, v} patch ops, possibly nested arrays.
      if (Array.isArray(obj.v)) { obj.v.forEach(applyOp); return; }
      if (obj.o === 'patch' && Array.isArray(obj.v)) { obj.v.forEach(applyOp); return; }

      if (typeof obj.v === 'string') {
        const p = typeof obj.p === 'string' ? obj.p : lastPath;
        if (isPartsPath(p) || (obj.p === undefined && isPartsPath(lastPath))) {
          if (obj.o === 'append' || obj.o === undefined) assistantText += obj.v;
          else if (obj.o === 'replace') assistantText = obj.v;
          lastPath = p;
          sawCumulative = false;
          return;
        }
        if (isPartsPath(obj.p)) { lastPath = obj.p; }
      }

      if (obj.v && typeof obj.v === 'object' && !obj.v.message) applyOp(obj.v);
    }

    return {
      feed(line) {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let obj;
        try { obj = JSON.parse(payload); } catch (_) { return; }
        applyOp(obj);
        const hits = probe(obj);
        if (hits.length) emit('probe', { source: 'stream', hits });
      },
      text: () => assistantText,
      cumulative: () => sawCumulative
    };
  }

  async function drainStream(stream) {
    const dec = makeStreamDecoder();
    const reader = stream.getReader();
    const td = new TextDecoder();
    let buf = '';
    let lastEmit = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += td.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          dec.feed(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
        const now = Date.now();
        if (now - lastEmit > 250) {
          lastEmit = now;
          emit('stream-text', { text: dec.text() });
        }
      }
    } catch (_) {
      /* stream aborted — fall through and report what we have */
    }
    emit('stream-text', { text: dec.text() });
    emit('stream-done', { text: dec.text() });
  }

  /* ------------------------------------------------------------- fetch --- */

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    harvestHeaders(input, init);

    // Outgoing user message, so the count moves the moment you hit send.
    if (ENDPOINTS.conversationStream.test(url) && init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        const m = body && body.messages && body.messages[0];
        const parts = m && m.content && m.content.parts;
        if (Array.isArray(parts)) {
          emit('user-message', {
            text: parts.filter((x) => typeof x === 'string').join('\n'),
            model: body.model || null
          });
        }
      } catch (_) {}
    }

    return origFetch.apply(this, arguments).then((res) => {
      try {
        const detail = ENDPOINTS.conversationDetail.exec(url);
        if (detail && res.ok) {
          res.clone().json().then((json) => {
            emit('conversation', { id: detail[1], data: json });
            const hits = probe(json);
            if (hits.length) emit('probe', { source: 'conversation', hits });
          }).catch(() => {});
        } else if (
          ENDPOINTS.conversationStream.test(url) &&
          res.ok &&
          res.body &&
          (res.headers.get('content-type') || '').includes('event-stream')
        ) {
          drainStream(res.clone().body);
        }
      } catch (_) {}
      return res;
    });
  };

  /* --------------------------------------------------------------- xhr --- */

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gtcUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__gtcUrl && ENDPOINTS.authScope.test(this.__gtcUrl)) {
      if (/^authorization$/i.test(k) && v) { auth.token = v; emit('auth', { hasToken: true }); }
      if (/^chatgpt-account-id$/i.test(k) && v) auth.accountId = v;
    }
    return origSetHeader.apply(this, arguments);
  };

  /* ------------------------------------------------------------ bridge --- */

  // The content script cannot mint an authorised request; it asks us to.
  window.addEventListener('gtc:request', async (e) => {
    const { id, path } = e.detail || {};
    if (!id || typeof path !== 'string' || !path.startsWith('/')) return;
    const headers = { accept: '*/*' };
    if (auth.token) headers.authorization = auth.token;
    if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;
    let out = { id, ok: false, status: 0, data: null };
    try {
      const r = await origFetch(location.origin + path, {
        method: 'GET',
        credentials: 'include',
        headers
      });
      out.status = r.status;
      out.ok = r.ok;
      if (r.ok) out.data = await r.json();
    } catch (err) {
      out.error = String(err && err.message);
    }
    emit('response', out);
  });

  // Request and reply use distinct names so the asker never hears itself.
  window.addEventListener('gtc:usage-candidates', () => {
    emit('usage-candidates-result', { paths: ENDPOINTS.usageCandidates });
  });

  /* ----------------------------------------------------------- routing --- */

  const notify = () => emit('navigate', { path: location.pathname });
  ['pushState', 'replaceState'].forEach((fn) => {
    const orig = history[fn];
    history[fn] = function () {
      const r = orig.apply(this, arguments);
      setTimeout(notify, 0);
      return r;
    };
  });
  window.addEventListener('popstate', notify);

  emit('ready', {});
})();
