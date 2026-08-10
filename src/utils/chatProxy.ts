/**
 * Normalizes an OpenAI-compatible base URL so it always points at the
 * `/chat/completions` endpoint.
 *
 * AI profiles store the API *root* (e.g. `https://api.openai.com/v1`),
 * never the full chat endpoint. The old Node.js backend appended
 * `/chat/completions` server-side; in the standalone desktop build we must
 * do it client-side, otherwise the request hits the provider root, which
 * returns 404 with NO CORS headers → the browser blocks it and fetch()
 * throws "Failed to fetch".
 *
 * Handles every supported preset root:
 *  - https://api.openai.com/v1
 *  - https://openrouter.ai/api/v1
 *  - https://api.deepseek.com/v1
 *  - https://api.groq.com/openai/v1
 *  - https://api.moonshot.cn/v1
 *  - http://localhost:11434/v1          (Ollama)
 *  - https://generativelanguage.googleapis.com/v1beta/openai   (Gemini OpenAI-compat)
 * And no-ops when the user already pasted the full endpoint.
 */
export function resolveChatCompletionsUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim();
  if (!url) return url;
  // Strip trailing slashes (but keep the scheme/host intact)
  url = url.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(url)) return url;
  return url + '/chat/completions';
}

/**
 * Universal fetch that tries the browser's fetch first (fast, native
 * streaming for CORS-friendly providers) and falls back to Tauri's
 * Rust-side HTTP plugin when the browser blocks the request (CSP or CORS).
 *
 * This makes NVAPI / Nvidia, Zhipu (Z-AI), and any other CORS-restrictive
 * OpenAI-compatible endpoint work in the desktop app, because the fallback
 * request originates from Rust, which is not subject to browser CORS or CSP.
 *
 * The Response shape is identical for both paths (body is a ReadableStream),
 * so SSE streaming works transparently.
 */
let _tauriFetch: ((input: string, init?: any) => Promise<Response>) | null = null;
async function getTauriFetch() {
  if (_tauriFetch) return _tauriFetch;
  try {
    const mod = await import('@tauri-apps/plugin-http');
    _tauriFetch = mod.fetch as typeof fetch;
  } catch {
    _tauriFetch = null;
  }
  return _tauriFetch;
}

export async function universalFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (browserErr: any) {
    // Only fall back to the Rust HTTP plugin on a network-layer failure
    // (TypeError "Failed to fetch" caused by CSP/CORS). HTTP error
    // responses (4xx/5xx) are NOT caught here — they are valid Responses.
    const isNetworkFailure =
      browserErr instanceof TypeError ||
      browserErr?.name === 'TypeError' ||
      /failed to fetch|networkerror|load failed/i.test(browserErr?.message || '');
    if (!isNetworkFailure) throw browserErr;

    const tauriFetch = await getTauriFetch();
    if (!tauriFetch) throw browserErr; // not running in Tauri — rethrow original

    // Retry via Rust-side HTTP (bypasses CSP + CORS).
    const tauriInit: any = {
      method: init?.method || 'GET',
      headers: init?.headers,
      body: init?.body,
    };
    if (init?.signal) tauriInit.signal = init.signal;
    return await tauriFetch(input, tauriInit);
  }
}

export async function performChatRequest(payloadObj: any) {
  const { baseUrl: targetUrl, apiKey, model, messages, stream, system_prompt, custom_headers, max_tokens, reasoning_effort, web_search_context } = payloadObj.body ? JSON.parse(payloadObj.body) : payloadObj;

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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (targetUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://ai.studio/build';
    headers['X-Title'] = 'SAW AI Workspace';
  }

  if (custom_headers && typeof custom_headers === 'object') {
    Object.assign(headers, custom_headers);
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
    model: model || 'gpt-4o',
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

