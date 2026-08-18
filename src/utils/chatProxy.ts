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

  return await universalFetch(resolvedUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(fetchPayload),
    signal: payloadObj.signal,
  });
}

/**
 * Key-free, CORS-friendly web search.
 * Combines the DuckDuckGo Instant Answer API (instant answers / abstracts)
 * with the Wikipedia search API (full result lists). Neither requires an API
 * key and both send `Access-Control-Allow-Origin: *`, so they work directly
 * from the Tauri webview / browser with no backend proxy.
 */
export async function performSearchRequest(payloadObj: any) {
  const { query, maxResults } = payloadObj.body ? JSON.parse(payloadObj.body) : payloadObj;
  const q = (query || '').trim();
  const limit = Math.max(1, Math.min(maxResults || 5, 8));

  const results: any[] = [];

  try {
    // 1. DuckDuckGo Instant Answer API — gives a concise abstract / answer when available
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const ddgRes = await universalFetch(ddgUrl, { signal: payloadObj.signal });
    if (ddgRes.ok) {
      const ddg = await ddgRes.json();
      const abstractText = (ddg.AbstractText || '').trim();
      const abstractSource = (ddg.AbstractSource || '').trim();
      const abstractUrl = (ddg.AbstractURL || '').trim();
      const heading = (ddg.Heading || '').trim();

      if (abstractText) {
        results.push({
          title: heading || q,
          snippet: abstractText,
          url: abstractUrl || (ddg.DefinitionURL || ''),
        });
      }

      // RelatedTopics is a flat + nested array; pull leaf topics that have a real text/url
      const flatten = (arr: any[]) => {
        for (const item of arr) {
          if (!item) continue;
          if (item.Topics && Array.isArray(item.Topics)) {
            flatten(item.Topics);
          } else if (item.Text && item.FirstURL) {
            results.push({
              title: item.Text.split(' - ')[0] || item.Text,
              snippet: item.Text,
              url: item.FirstURL,
            });
          }
        }
      };
      if (Array.isArray(ddg.RelatedTopics)) flatten(ddg.RelatedTopics);

      // DuckDuckGo definition (for "define" style queries)
      if (!abstractText && ddg.Definition) {
        results.push({
          title: heading || q,
          snippet: ddg.Definition,
          url: ddg.DefinitionURL || '',
        });
      }
    }
  } catch (e) {
    // DuckDuckGo is best-effort; fall through to Wikipedia
  }

  try {
    // 2. Wikipedia API — rich full-text search results to round out the answer set
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=${limit}`;
    const wikiRes = await universalFetch(wikiUrl, { signal: payloadObj.signal });
    if (wikiRes.ok) {
      const wiki = await wikiRes.json();
      const hits = wiki?.query?.search || [];
      for (const hit of hits) {
        const title = hit.title || '';
        const snippet = (hit.snippet || '').replace(/<[^>]+>/g, ''); // strip highlight spans
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        if (!results.some((r) => r.title === title)) {
          results.push({ title, snippet, url });
        }
      }
    }
  } catch (e) {
    // Wikipedia is best-effort
  }

  return {
    ok: results.length > 0,
    json: async () => ({ results: results.slice(0, limit) }),
  };
}

