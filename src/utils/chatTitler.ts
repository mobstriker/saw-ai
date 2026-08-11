import { AIProfile, BYOKSettings } from '../types';
import { ModelRouter } from './modelRouter';
import { resolveChatCompletionsUrl, resolveModelForEndpoint, universalFetch } from './chatProxy';

export class ChatTitler {
  /**
   * Generates a clean, intelligent 2-5 word heuristic title immediately
   * from the user's first prompt without network latency.
   */
  static generateFastHeuristicTitle(rawPrompt: string): string {
    if (!rawPrompt || !rawPrompt.trim()) {
      return 'New Conversation';
    }

    let text = rawPrompt.trim();

    // 1. Remove code blocks and markdown
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/[#*_~>]/g, '');

    // 2. Remove common conversational filler / imperative prefixes
    const fillerPrefixes = [
      /^(can you please|could you please|please can you|please|can you|could you|would you|i want you to|i need you to|help me|assist me in)\s+/i,
      /^(how do i|how to|how can i|what is the best way to|what is the|what is|what are|explain how to|explain)\s+/i,
      /^(write a|write an|build a|build an|create a|create an|make a|make an|implement a|implement an|generate a|generate an|design a|design an)\s+/i,
      /^(fix the|fix this|debug the|debug this|refactor the|refactor this|optimize the|optimize this|update the|update this)\s+/i,
      /^(tell me about|summarize the|summarize|give me a|give me|show me|find the|search for)\s+/i,
    ];

    let cleaned = text;
    for (const regex of fillerPrefixes) {
      cleaned = cleaned.replace(regex, '');
    }

    // 3. Remove punctuation & special characters
    cleaned = cleaned.replace(/[?.,!;:()[\]{}"'\\/]/g, ' ').replace(/\s+/g, ' ').trim();

    if (!cleaned) {
      return 'New Conversation';
    }

    // 4. Handle short greetings
    const lower = cleaned.toLowerCase();
    if (['hi', 'hello', 'hey', 'greetings', 'sup', 'yo'].includes(lower)) {
      return 'General Greeting';
    }

    // 5. Extract the first 3 to 6 meaningful words
    const words = cleaned.split(/\s+/).filter(Boolean);
    const selectedWords = words.slice(0, 5);

    // 6. Title Case the extracted words
    const titleCased = selectedWords
      .map((w) => {
        if (w.length <= 2 && ['to', 'of', 'in', 'on', 'at', 'by', 'for', 'a', 'an', 'the', 'and', 'or'].includes(w.toLowerCase())) {
          return w.toLowerCase();
        }
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');

    // Capitalize first character if needed
    const finalTitle = titleCased.charAt(0).toUpperCase() + titleCased.slice(1);

    return finalTitle.length > 36 ? finalTitle.slice(0, 35) + '…' : finalTitle;
  }

  /**
   * Generates a concise AI-summarized chat title using the user-configured flash/fast model.
   * If no API key is configured or the call fails, smoothly returns the heuristic title.
   */
  static async generateAIChatTitle(params: {
    prompt: string;
    profile?: AIProfile | null;
    settings?: BYOKSettings;
  }): Promise<string> {
    const heuristicFallback = this.generateFastHeuristicTitle(params.prompt);

    const { prompt, profile, settings } = params;
    if (!prompt || !prompt.trim()) {
      return heuristicFallback;
    }

    // Resolve user-configured flash/fast model
    const resolvedTarget = ModelRouter.resolveModel(profile || undefined, 'flash');
    const baseUrl = resolvedTarget.baseUrl || settings?.baseUrl;
    const apiKey = resolvedTarget.apiKey || settings?.apiKey;
    const rawModel = resolvedTarget.model || 'gpt-4o-mini';
    // Normalize model id for the endpoint (strip provider/ prefix for direct APIs)
    const model = baseUrl ? resolveModelForEndpoint(baseUrl, rawModel) : rawModel;
    const customHeaders = resolvedTarget.customHeaders || settings?.customHeaders;

    // If user has not configured an API key (and not local endpoint), keep the fast heuristic title
    const isLocal =
      baseUrl &&
      (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('0.0.0.0'));

    if (!apiKey && !isLocal) {
      return heuristicFallback;
    }
    if (!baseUrl || !baseUrl.trim()) {
      return heuristicFallback;
    }

    // Resolve custom headers (may be a JSON string or undefined)
    let parsedHeaders: Record<string, string> = {};
    if (customHeaders) {
      try {
        const maybeHeaders = typeof customHeaders === 'string' ? JSON.parse(customHeaders) : customHeaders;
        if (maybeHeaders && typeof maybeHeaders === 'object') {
          parsedHeaders = maybeHeaders as Record<string, string>;
        }
      } catch {}
    }

    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...parsedHeaders };
    if (apiKey) {
      requestHeaders['Authorization'] = `Bearer ${apiKey}`;
    }
    if (baseUrl && baseUrl.includes('openrouter.ai')) {
      requestHeaders['HTTP-Referer'] = 'https://ai.studio/build';
      requestHeaders['X-Title'] = 'SAW AI Workspace';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second fast timeout

      // Normalize the API root (e.g. https://api.openai.com/v1) to the
      // full chat completions endpoint, the same way the chat path does.
      const chatUrl = resolveChatCompletionsUrl(baseUrl);

      const response = await universalFetch(chatUrl, {
        method: 'POST',
        headers: requestHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content:
                'You are a titling assistant. Return ONLY a concise 2 to 5 word title summarizing the user prompt. Do not use quotation marks, markdown, or punctuation at the end. Keep it strictly under 35 characters.',
            },
            {
              role: 'user',
              content: prompt.slice(0, 400),
            },
          ],
          model: model,
          stream: false,
          max_tokens: 18,
          temperature: 0.2,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return heuristicFallback;
      }

      const data = await response.json();
      const rawTitle =
        data.choices?.[0]?.message?.content ||
        data.choices?.[0]?.text ||
        data.response ||
        '';

      if (rawTitle && typeof rawTitle === 'string') {
        let cleaned = rawTitle
          .replace(/^["'`\s]+|["'`\s]+$/g, '')
          .replace(/^(title:|\*\*title:\*\*)\s*/i, '')
          .replace(/[#*~`]/g, '')
          .replace(/\n.*/s, '') // keep only the first line
          .trim();

        if (cleaned.endsWith('.')) {
          cleaned = cleaned.slice(0, -1);
        }

        if (cleaned.length >= 2 && cleaned.length <= 45) {
          return cleaned;
        }
      }

      return heuristicFallback;
    } catch {
      // Graceful fallback to heuristic title on timeout or network hiccup
      return heuristicFallback;
    }
  }
}
