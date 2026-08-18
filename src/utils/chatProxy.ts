/**
 * Normalizes a user-provided OpenAI-compatible endpoint URL so it always
 * points at `/chat/completions`.
 *
 * This app is universal: the user pastes whatever their provider gives them —
 * the API root (`https://api.openai.com/v1`), a partial chat path
 * (`…/v1/chat`), or the full endpoint (`…/v1/chat/completions`). Whatever the
 * shape, with or without a trailing slash, this produces a correct
 * `/chat/completions` URL. Examples:
 *   https://api.openai.com/v1                         -> …/v1/chat/completions
 *   https://openrouter.ai/api/v1/                     -> …/api/v1/chat/completions
 *   https://api.example.com/v1/chat                  -> …/v1/chat/completions
 *   https://api.example.com/v1/chat/completions       -> (unchanged)
 *   https://api.example.com/v1/responses              -> …/v1/chat/completions
 */
export function resolveChatCompletionsUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim();
  if (!url) return url;
  url = url.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(url)) return url;
  // Strip a lone trailing `/chat` or `/responses` so we don't end up with
  // `/chat/chat/completions`.
  url = url.replace(/\/(chat|responses)$/i, '');
  return url + '/chat/completions';
}

/**
 * Returns the model identifier exactly as configured.
 *
 * The app is provider-agnostic: whatever model string the user enters is sent
 * verbatim to their OpenAI-compatible endpoint. No per-host special-casing,
 * no prefix stripping -- so it works with every provider (OpenAI, OpenRouter,
 * Zhipu, Moonshot, NVIDIA NIM, Token Router, local Ollama/vLLM, ...) without
 * the app ever guessing what the endpoint expects. The user is in full control.
 */
export function resolveModelForEndpoint(_baseUrl: string, model: string): string {
  return (model || '').trim();
}

/**
 * Detects whether the app is running inside the Tauri desktop webview.
 *
 * The desktop webview (WebView2 on Windows, WebKit on macOS/Linux) IS a real
 * browser engine, so its native `fetch` behaves exactly like the web app's
 * fetch — same TLS/HTTP2 fingerprint, same redirect/cookie handling, same
 * streaming. This is why requests that work on the web must also be sent
 * through the webview's native fetch on desktop: it is the same engine.
 */
function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  // Tauri v2 injects __TAURI_INTERNALS__ into the webview
  return !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
}

let _tauriFetch: ((input: string, init?: any) => Promise<Response>) | null = null;
let _tauriFetchChecked = false;
async function getTauriFetch() {
  if (_tauriFetchChecked) return _tauriFetch;
  _tauriFetchChecked = true;
  try {
    const mod = await import('@tauri-apps/plugin-http');
    _tauriFetch = mod.fetch as typeof fetch;
  } catch {
    _tauriFetch = null;
  }
  return _tauriFetch;
}

function buildTauriInit(init?: RequestInit): any {
  const tauriInit: any = {
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body,
  };
  if (init?.signal) tauriInit.signal = init.signal;
  return tauriInit;
}

function isNetworkOrCorsFailure(err: any): boolean {
  return (
    err instanceof TypeError ||
    err?.name === 'TypeError' ||
    /failed to fetch|networkerror|load failed|cors|blocked/i.test(
      err?.message || ''
    )
  );
}

/**
 * Universal fetch for both web and desktop.
 *
 * Strategy (provider-agnostic — no host lists, no special-casing):
 *
 *  1. ALWAYS try the webview/browser's NATIVE fetch first. On the web this
 *     is the only path. On desktop, the Tauri webview is a real browser
 *     engine (WebView2/WebKit), so native fetch behaves identically to the
 *     web app — same TLS fingerprint, same streaming, same behavior. This
 *     is what makes every provider that worked on web also work on desktop.
 *
 *  2. Only if native fetch throws a genuine network/CORS failure (the
 *     provider doesn't send permissive CORS headers, so the browser engine
 *     blocks the cross-origin request) do we fall back to the Tauri
 *     Rust-side HTTP plugin, which originates the request from native code
 *     and therefore bypasses CORS entirely.
 *
 * This is strictly better than preferring the Rust client: the Rust client
 * (reqwest) is not a browser, and some providers' edge gateways treat its
 * TLS/HTTP2 fingerprint differently than a real browser's, causing
 * provider-specific failures that look like "this provider's models don't
 * work" even though a real browser reaches them fine. Routing through the
 * real browser engine first eliminates that entire class of bug.
 *
 * HTTP error responses (401/403/429/500...) are NOT network failures — they
 * are returned as normal Responses so the caller can surface the real
 * provider error message; we never retry those via the fallback.
 */
export async function universalFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  // 1. Native browser/webview fetch first — identical to the web app.
  try {
    return await fetch(input, init);
  } catch (err: any) {
    if (!isNetworkOrCorsFailure(err)) throw err;

    // 2. Network/CORS failure — fall back to the Tauri Rust HTTP plugin,
    //    which bypasses CORS. Only available inside the desktop app.
    if (isTauriEnvironment()) {
      const tauriFetch = await getTauriFetch();
      if (tauriFetch) {
        return await tauriFetch(input, buildTauriInit(init));
      }
    }

    throw err; // not in Tauri, or plugin unavailable — rethrow original
  }
}

export async function performChatRequest(payloadObj: any) {
  const { baseUrl: targetUrl, apiKey, model, messages, stream, system_prompt, custom_headers, max_tokens, reasoning_effort, web_search_context, mcp_tools } = payloadObj.body ? JSON.parse(payloadObj.body) : payloadObj;
  // --- Transparency guards: fail loudly instead of silently falling back ---
  if (!targetUrl || !targetUrl.trim()) {
    throw new Error('No API endpoint configured. Add an AI profile in Settings (⚙️) and enter a Base URL.');
  }
  const isLocalEndpoint =
    targetUrl.includes('localhost') ||
    targetUrl.includes('127.0.0.1') ||
    targetUrl.includes('0.0.0.0');
  if (!apiKey && !isLocalEndpoint) {
    throw new Error('No API key configured for this profile. Add your API key in Settings (⚙️).');
  }

  const resolvedUrl = resolveChatCompletionsUrl(targetUrl);
  // Send the model id exactly as the user configured it; the endpoint knows
  // what it expects (e.g. OpenRouter's "provider/model", or a bare model name).
  const resolvedModel = resolveModelForEndpoint(targetUrl, model);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // A standard browser-like User-Agent bypasses Cloudflare bot checks for
    // providers that gate on it; harmless everywhere else. Any provider-specific
    // headers (e.g. OpenRouter's HTTP-Referer/X-Title) are added via custom_headers.
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SAW-AI-Workspace/2.4.0',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (custom_headers) {
    let parsedCustom: Record<string, string> = {};
    if (typeof custom_headers === 'string') {
      try {
        parsedCustom = JSON.parse(custom_headers);
      } catch {
        // malformed JSON string — skip
      }
    } else if (typeof custom_headers === 'object') {
      parsedCustom = custom_headers;
    }
    if (parsedCustom && typeof parsedCustom === 'object') {
      Object.assign(headers, parsedCustom);
    }
  }

  // Build the message list. Inject web search results into the latest user
  // message so the model actually sees them (the old backend did this).
  let finalMessages = Array.isArray(messages) ? messages : [];
  if (web_search_context && Array.isArray(web_search_context) && web_search_context.length > 0) {
    const searchBlock = web_search_context
      .map((r: any, i: number) => `[${i + 1}] ${r.title || '(untitled)'}\n${r.snippet || ''}\nURL: ${r.url || ''}`)
      .join('\n\n');
    const injection = `\n\n---\n[WEB SEARCH RESULTS]\nUse these fresh web results to answer accurately. Cite sources by number.\n\n${searchBlock}\n---`;

    finalMessages = finalMessages.map((m: any, i: number) => {
      if (m.role === 'user' && i === finalMessages.length - 1) {
        return { ...m, content: (m.content || '') + injection };
      }
      return m;
    });
  }

  const fetchPayload: any = {
    model: resolvedModel || model || 'gpt-4o',
    messages: finalMessages,
    stream,
  };

  if (system_prompt) {
    if (fetchPayload.messages.length > 0 && fetchPayload.messages[0].role === 'system') {
      fetchPayload.messages[0].content = system_prompt;
    } else {
      fetchPayload.messages.unshift({ role: 'system', content: system_prompt });
    }
  }

  if (max_tokens && max_tokens > 0) {
    fetchPayload.max_tokens = max_tokens;
  }

  // Reasoning effort: only send when explicitly enabled (not 'off'). Many
  // OpenAI-compatible providers reject the unknown `reasoning_effort` field (or
  // an unsupported value) with a 400 "unknown parameter", which the old code
  // triggered on EVERY request — even for plain chat — because it always sent
  // the field. Omitting it when 'off' keeps the request clean for providers
  // that don't support extended thinking.
  if (reasoning_effort && reasoning_effort !== 'off') {
    fetchPayload.reasoning_effort = reasoning_effort;
  }

  // MCP tools: advertise them to the provider as native function-calling
  // tools so models that support tool_calls invoke them directly. Each tool is
  // namespaced as "<serverName>/<toolName>" so the app can route the returned
  // tool_call back to the originating server. The system prompt also describes
  // them in text (for providers without function calling the model is told to
  // emit ```mcp_tool_call blocks instead).
  if (Array.isArray(mcp_tools) && mcp_tools.length > 0) {
    fetchPayload.tools = mcp_tools.map((t: any) => ({
      type: 'function',
      function: {
        name: t._namespaced || t.name,
        description: t.description || `MCP tool: ${t.name}`,
        parameters: t.parametersSchema
          ? (() => {
              try {
                return typeof t.parametersSchema === 'string'
                  ? JSON.parse(t.parametersSchema)
                  : t.parametersSchema;
              } catch {
                return { type: 'object', properties: {} };
              }
            })()
          : { type: 'object', properties: {} },
      },
    }));
    fetchPayload.tool_choice = 'auto';
  }

  return await fetchChatWithRetry(resolvedUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(fetchPayload),
    signal: payloadObj.signal,
  });
}

/**
 * Retry genuinely-transient failures a few times before giving up. This directly
 * implements the user's requirement: "if the connection works [on retry], do
 * not show me an error/retry/continue card in the middle of the 1st/2nd/3rd
 * prompt." Providers — notably Google's Gemini OpenAI-compatible frontend —
 * intermittently return HTTP 403 on load-balancer hiccups or during API-key
 * propagation and then succeed on the next attempt; transient 429 / 408 / 5xx
 * and raw network errors behave the same. We retry those silently.
 *
 * We NEVER retry deterministic client errors (400 bad request, 401 auth, 404
 * model-not-found, 403-forbidden-with-a-permanent-body) because retrying them is
 * pointless and would just burn time before showing the SAME real error. The
 * distinction for 403: a body that clearly indicates a permanent permission /
 * API-key problem (e.g. "API key not valid", "permission denied", "has not been
 * used before") is NOT retried — a transient LB 403 has an empty/generic body
 * and IS retried. This keeps a genuinely-bad key/config surfacing immediately
 * while a transient hiccup self-heals without bothering the user.
 */
const TRANSIENT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function looksLikePermanent403Body(body: string): boolean {
  const b = (body || '').toLowerCase();
  // Phrases that mean the key/config is genuinely wrong — do not retry.
  return (
    b.includes('api key not valid') ||
    b.includes('api key not found') ||
    b.includes('api key invalid') ||
    b.includes('invalid api key') ||
    b.includes('permission denied') ||
    b.includes('access is denied') ||
    b.includes('not authorized') ||
    b.includes('has not been used before') ||
    b.includes('is not enabled') ||
    b.includes('api not enabled') ||
    b.includes('forbidden') ||
    b.includes('safety') ||
    b.includes('recaptcha')
  );
}

function isRetryableNetworkError(err: any): boolean {
  const m = (err?.message || '').toLowerCase();
  // A genuine transport/CORS failure (as opposed to a thrown HTTP response).
  // Aborts are handled separately (we rethrow AbortError before this).
  return (
    err?.name === 'TypeError' || // fetch() network failure
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('load failed') ||
    m.includes('econnreset') ||
    m.includes('socket hang up') ||
    m.includes('timed out')
  );
}

async function fetchChatWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  const signal = init.signal as AbortSignal | undefined;
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Honor an already-aborted request (user clicked stop).
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let res: Response | null = null;
    try {
      res = await universalFetch(url, init);
    } catch (err: any) {
      // Network-level error: transient — retry (unless the user aborted).
      if (signal?.aborted || (err?.name === 'AbortError')) throw err;
      lastError = err;
      if (attempt < maxAttempts && isRetryableNetworkError(err)) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
    if (res.ok) return res;

    // Non-ok response: decide whether it's transient (retry) or permanent (throw).
    const status = res.status;
    const bodyText = await res.text().catch(() => '');
    const permanent =
      status === 403 ? looksLikePermanent403Body(bodyText) : false;
    const transient =
      !permanent &&
      (TRANSIENT_RETRY_STATUSES.has(status) ||
        status === 403);

    if (transient && attempt < maxAttempts) {
      await sleep(backoffMs(attempt));
      continue;
    }

    // Permanent error or out of retries — rethrow as an Error carrying the real
    // HTTP status + provider message so the caller's classifier (which checks
    // `typeof e.status === 'number'`) can show the true cause instead of a
    // generic "connection interrupted".
    let errJson: any = {};
    try { errJson = JSON.parse(bodyText); } catch { errJson = {}; }
    const msg = extractChatErrorMessage(errJson, status, bodyText);
    const httpErr = new Error(msg);
    (httpErr as any).status = status;
    (httpErr as any).name = 'HttpProviderError';
    throw httpErr;
  }
  // Should be unreachable, but keep the type-checker happy.
  throw lastError ?? new Error('Chat request failed.');
}

function backoffMs(attempt: number): number {
  // 350ms, 800ms — short, so the 2nd/3rd prompt isn't delayed noticeably while
  // still spacing out retries to let a transient LB/key-propagation clear.
  const base = attempt === 1 ? 350 : 800;
  return base + Math.floor(Math.random() * 200);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function extractChatErrorMessage(json: any, status: number, rawText?: string): string {
  if (!json) return rawText?.trim() || `HTTP ${status}`;
  if (typeof json === 'string') return json;
  if (typeof json.message === 'string') return json.message;
  if (typeof json.error === 'string') return json.error;
  if (json.error && typeof json.error === 'object') {
    if (typeof json.error.message === 'string') return json.error.message;
    if (typeof json.error.type === 'string') return `${json.error.type}: ${json.error.message || ''}`.trim();
  }
  if (json.detail && typeof json.detail === 'string') return json.detail;
  if (rawText && rawText.length < 500) return rawText.trim();
  return `HTTP ${status}`;
}


/**
 * Key-free, CORS-friendly web search.
 *
 * The provider selected in Settings decides which backends run:
 *   - 'duckduckgo'         → DuckDuckGo HTML results + Instant Answer API
 *   - 'wikipedia'          → Wikipedia search API only
 *   - 'duckduckgo_wikipedia' (default) → DuckDuckGo + Wikipedia (best free mix)
 *   - 'tavily'             → Tavily API (needs a key); falls back to DDG on failure
 *
 * DuckDuckGo and Wikipedia require no API key and both send permissive CORS
 * headers (or work through the Tauri http plugin on desktop, which bypasses
 * CORS), so they work directly from the webview/browser with no backend proxy.
 */
export async function performSearchRequest(payloadObj: any) {
  const parsed = payloadObj.body ? JSON.parse(payloadObj.body) : payloadObj;
  const { query, maxResults, provider, apiKey } = parsed;
  const q = (query || '').trim();
  const limit = Math.max(1, Math.min(maxResults || 5, 8));
  const backend = provider || 'duckduckgo_wikipedia';

  const results: any[] = [];
  // Track whether the AI will actually receive search context; the caller can
  // read this to show a "grounded N results" indicator.

  // Tavily — highest quality, needs a key. Returns clean answer + sources.
  if (backend === 'tavily' && apiKey) {
    try {
      const tvRes = await universalFetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: q,
          max_results: limit,
          include_answer: true,
        }),
        signal: payloadObj.signal,
      });
      if (tvRes.ok) {
        const tv = await tvRes.json();
        if (tv.answer) {
          results.push({ title: 'Tavily answer', snippet: tv.answer, url: '' });
        }
        if (Array.isArray(tv.results)) {
          for (const r of tv.results) {
            results.push({ title: r.title || '', snippet: r.content || '', url: r.url || '' });
          }
        }
        if (results.length > 0) {
          return { ok: true, json: async () => ({ results: results.slice(0, limit), grounded: true }) };
        }
      }
    } catch {
      // fall through to free backends
    }
  }

  // DuckDuckGo HTML results — the KEY free path. The old code used the Instant
  // Answer API, which returns an abstract ONLY for encyclopedic/dictionary
  // queries and NOTHING for weather/news/live prices/current events. The HTML
  // results page returns real ranked web results for EVERY query type. We fetch
  // it through universalFetch (the Tauri http plugin in the desktop build
  // bypasses CORS, so this works there; in the pure-web build it may be
  // CORS-blocked and we fall back to the IA API + Wikipedia below).
  const useDdg = backend === 'duckduckgo' || backend === 'duckduckgo_wikipedia' || (backend === 'tavily' && results.length === 0);
  if (useDdg) {
    try {
      const ddgHtmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const ddgHtmlRes = await universalFetch(ddgHtmlUrl, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: payloadObj.signal,
      });
      if (ddgHtmlRes.ok) {
        const html = await ddgHtmlRes.text();
        // Each organic result lives in a `.result` block with `.result__a` (title+url)
        // and `.result__snippet` (text). Parse defensively.
        const resultBlocks = html.split(/class="result\s/);
        for (const block of resultBlocks.slice(1)) {
          if (results.length >= limit) break;
          const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
          const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/i);
          if (titleMatch) {
            let url = titleMatch[1] || '';
            // DDG wraps URLs in a redirect (//duckduckgo.com/l/?uddg=<encoded>); unwrap.
            const uddg = url.match(/uddg=([^&]+)/);
            if (uddg) url = decodeURIComponent(uddg[1]);
            const title = decodeHtml(titleMatch[2].replace(/<[^>]+>/g, '').trim());
            const snippet = snippetMatch ? decodeHtml(snippetMatch[1].replace(/<[^>]+>/g, '').trim()) : '';
            if (title && !results.some((r) => r.title === title)) {
              results.push({ title, snippet, url });
            }
          }
        }
      }
    } catch {
      // CORS/network — fall through to IA API + Wikipedia
    }

    // DuckDuckGo Instant Answer API — supplement (good for definitions/abstracts).
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
      const ddgRes = await universalFetch(ddgUrl, { signal: payloadObj.signal });
      if (ddgRes.ok) {
        const ddg = await ddgRes.json();
        const abstractText = (ddg.AbstractText || '').trim();
        const abstractUrl = (ddg.AbstractURL || '').trim();
        const heading = (ddg.Heading || '').trim();
        if (abstractText && !results.some((r) => r.snippet === abstractText)) {
          results.unshift({ title: heading || q, snippet: abstractText, url: abstractUrl || '' });
        }
      }
    } catch {
      // best-effort
    }
  }

  // Wikipedia — encyclopedic context. Runs for the 'wikipedia' and combined
  // backends, and as a free supplement when DDG returned nothing.
  const useWiki = backend === 'wikipedia' || backend === 'duckduckgo_wikipedia' || results.length === 0;
  if (useWiki) {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=${Math.min(limit, 3)}`;
      const wikiRes = await universalFetch(wikiUrl, { signal: payloadObj.signal });
      if (wikiRes.ok) {
        const wiki = await wikiRes.json();
        const hits = wiki?.query?.search || [];
        for (const hit of hits) {
          if (results.length >= limit) break;
          const title = hit.title || '';
          const snippet = (hit.snippet || '').replace(/<[^>]+>/g, '');
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
          if (!results.some((r) => r.title === title)) {
            results.push({ title, snippet, url });
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  return {
    ok: results.length > 0,
    json: async () => ({ results: results.slice(0, limit), grounded: results.length > 0 }),
  };
}

/** Minimal HTML-entity decoder so search snippets render readably. */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

