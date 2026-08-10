export async function performChatRequest(payloadObj: any) {
  const { baseUrl: targetUrl, apiKey, model, messages, stream, system_prompt, custom_headers, max_tokens, reasoning_effort } = payloadObj.body ? JSON.parse(payloadObj.body) : payloadObj;
  
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

  const fetchPayload: any = {
    model: model || 'gpt-4o',
    messages: messages,
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

  return await fetch(targetUrl, {
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
    const ddgRes = await fetch(ddgUrl, { signal: payloadObj.signal });
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
    const wikiRes = await fetch(wikiUrl, { signal: payloadObj.signal });
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

