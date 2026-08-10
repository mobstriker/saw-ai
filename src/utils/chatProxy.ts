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
  });
}

export async function performSearchRequest(payloadObj: any) {
  // Web search is not implemented natively without backend or API key in this Tauri build.
  // We can return a mocked successful empty response or just fail gracefully.
  return {
    ok: true,
    json: async () => ({ results: [] })
  };
}
