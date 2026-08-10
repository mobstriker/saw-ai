/**
 * Intent Detector & Query Classifier
 * Prevents unnecessary Web Search API calls, skill bloating, and tool overhead
 * for simple conversational greetings, standard programming requests, and math.
 */

import { Message, ProjectFile } from '../types';

export interface IntentAnalysis {
  isGreetingOrSocial: boolean;
  needsWebSearch: boolean;
  needsSkills: boolean;
  searchReason?: string;
  resolvedQuery?: string;
}

export const IntentDetector = {
  /**
   * Identifies simple conversational greetings, pleasantries, and small talk
   */
  isGreetingOrSocial(query: string): boolean {
    if (!query) return false;
    const clean = query.trim().toLowerCase();

    // If the query is long (>15 words) or contains explicit questions about weather/coding/facts, it's NOT just a greeting
    if (clean.split(/\s+/).length > 12) return false;
    if (/\b(?:weather|forecast|temperature|code|file|function|error|bug|search|look up|price|news|why|how to|what is)\b/i.test(clean)) {
      return false;
    }

    // Direct exact or near-exact short greetings & conversational phrases
    const exactGreetings = [
      'hello',
      'hello!',
      'hello.',
      'hi',
      'hi!',
      'hi.',
      'hey',
      'hey!',
      'hey there',
      'greetings',
      'howdy',
      'yo',
      'sup',
      'good morning',
      'good afternoon',
      'good evening',
      'good day',
      'how are you',
      'how are you doing',
      "what's up",
      'whats up',
      'who are you',
      'what can you do',
      'help',
      'thanks',
      'thank you',
      'ok',
      'okay',
      'cool',
      'awesome',
      'great',
      'bye',
      'goodbye',
      'see you',
      'i just want to talk',
      'just want to talk',
      'i want to talk',
      'i want to chat',
      'can we talk',
      'let\'s talk',
      'lets talk',
      'let\'s chat',
      'lets chat',
      'talk to me',
      'just chat',
      'chat with me',
      'i just want to chat',
      'tell me a joke',
      'tell me a story',
    ];

    if (exactGreetings.includes(clean)) return true;

    // Regex check for opening greetings without substantive tasks
    const greetingPattern =
      /^(?:hello|hi|hey|howdy|greetings|good\s+(?:morning|afternoon|evening|day))(?:\s+(?:there|assistant|bot|friend|world|ai))?[!.,?]*$/i;

    if (greetingPattern.test(clean)) return true;

    // Small talk / pleasantry patterns
    const smallTalkPattern =
      /^(?:how\s+are\s+you(?:\s+doing)?|how's\s+it\s+going|what\s+can\s+you\s+do|introduce\s+yourself|who\s+made\s+you|i\s+(?:just\s+)?want\s+to\s+(?:talk|chat)|let's\s+(?:talk|chat)|can\s+we\s+(?:talk|chat)|talk\s+to\s+me|tell\s+me\s+a\s+(?:joke|story))[!.,?]*$/i;

    return smallTalkPattern.test(clean);
  },

  /**
   * Determines whether a query genuinely requires real-time live internet search or external information grounding.
   * Runs in intelligent Auto mode so users do not have to manually toggle or repeat search commands.
   */
  shouldSearchWeb(query: string, userToggleEnabled: boolean = true, chatHistory: Message[] = []): boolean {
    if (!query) return false;
    // If the user explicitly disabled web search in settings or toggle is strictly false, skip
    if (userToggleEnabled === false) return false;

    const clean = query.trim().toLowerCase();

    // Rule 1: Never search for pure greetings, pleasantries, or small talk
    if (this.isGreetingOrSocial(clean)) {
      return false;
    }

    // Rule 2: Explicit search keywords and command phrases
    const explicitSearchKeywords = [
      'search the web',
      'search web',
      'search for',
      'search online',
      'look up online',
      'look up on the web',
      'browse the web',
      'google this',
      'google for',
      'find online',
      'check online',
      'find on the internet',
      'look on duckduckgo',
      'live search',
      'look up',
      'search',
    ];
    if (explicitSearchKeywords.some((k) => clean.includes(k))) {
      return true;
    }

    // Rule 3: Direct URL references
    if (/https?:\/\/[^\s]+|www\.[^\s]+/i.test(query)) {
      return true;
    }

    // Rule 4: Real-time information, current events, live stats, stock/crypto prices, sports, weather, news
    const realTimePatterns = [
      /\b(?:latest|recent|current|currently|today|yesterday|tomorrow|this week|this month|this year|2025|2026)\b/i,
      /\b(?:stock price|crypto price|exchange rate|bitcoin price|market cap of|valuation of)\b/i,
      /\b(?:who won|score of|game between|match between|standings|schedule of)\b/i,
      /\b(?:who is currently|current ceo of|current president of|current prime minister of)\b/i,
      /\b(?:release date of|when was .* released|changelog for|newest version of|specs of|documentation for)\b/i,
      /\b(?:news about|breaking news|headline|what happened in)\b/i,
      /\b(?:weather|temperature|forecast|climate|rain|snow|degrees|humidity|sunny|windy|storm)\b/i,
    ];

    if (realTimePatterns.some((pattern) => pattern.test(clean))) {
      return true;
    }

    // Rule 5: Contextual follow-up search prompts (e.g., "what about tomorrow?", "how about that?", "check that", "who is their CEO?")
    if (chatHistory && chatHistory.length > 0) {
      const isFollowUp = /\b(?:what about|how about|and tomorrow|and the weekend|is it|what is it|look that up|check it|tell me more|search for it)\b/i.test(clean);
      if (isFollowUp) {
        // Check if recent history had web search results or real-time questions
        const recentMessages = chatHistory.slice(-4);
        const hadSearchOrInfo = recentMessages.some((m) =>
          m.webSearchUsed || (m.searchResults && m.searchResults.length > 0) || m.role === 'user'
        );
        if (hadSearchOrInfo) return true;
      }
    }

    // Rule 6: Factual external lookups, queries about people, organizations, libraries, APIs
    const wordCount = clean.split(/\s+/).length;
    if (
      wordCount >= 3 &&
      /\b(population of|capital of|founder of|net worth of|founded in|score of|winner of|released in|specs of|documentation for|github repo for|official website of|who is|what is|where is|when was|how does .* work in|npm package|api docs)\b/i.test(clean)
    ) {
      return true;
    }

    // If user has the Web Search toggle ON in the chat bar and it's a substantive question (starts with what/who/when/where/how/why/is/are/can)
    if (userToggleEnabled && wordCount >= 3 && /^(?:what|who|when|where|why|how|is|are|can|which|tell me about|check)\b/i.test(clean)) {
      return true;
    }

    return false;
  },

  /**
   * Resolves and formulates an optimized, high-relevance search query from user prompt and chat history context.
   * Strips conversational boilerplate ("search the web and tell me", "and stuff like that")
   * and extracts referenced entities, topics, and pronouns from previous conversation turns.
   */
  resolveSearchQuery(
    currentPrompt: string,
    chatHistory: Message[] = [],
    workspaceFiles: ProjectFile[] = []
  ): string {
    if (!currentPrompt) return '';
    let raw = currentPrompt.trim();

    // Extract potential entity/topic candidate from recent chat messages (last 6 turns)
    let contextEntity = '';
    let contextLocation = '';

    if (chatHistory.length > 0) {
      const recentTurns = [...chatHistory].reverse().slice(0, 6);
      for (const msg of recentTurns) {
        const text = msg.content;

        // Check if a specific subject or title was searched or discussed
        if (!contextEntity && msg.searchResults && msg.searchResults.length > 0) {
          contextEntity = msg.searchResults[0].title.replace(/[-|].*$/, '').trim();
        }

        // Entity / topic extraction from text
        if (!contextEntity) {
          const entityMatch = text.match(/\b(?:about|regarding|check|search for|price of|docs for|version of)\s+([A-Za-z0-9_.\-\s]+)/i);
          if (entityMatch && entityMatch[1].trim().length >= 2) {
            contextEntity = entityMatch[1].trim().replace(/[.?!,]+$/, '');
          }
        }

        // Location extraction if present
        if (!contextLocation) {
          const locMatch = text.match(/\b(?:in|for|at|near|from)\s+([A-Za-z\s]+(?:\s*,\s*[A-Za-z\s]+)?)/i);
          if (locMatch && locMatch[1].trim().length >= 3) {
            contextLocation = locMatch[1].trim().replace(/[.?!,]+$/, '');
          }
        }
      }
    }

    // Strip conversational command noise from the query
    let cleaned = raw
      .replace(/^(?:can you\s+)?(?:please\s+)?(?:search\s+(?:the\s+)?web\s+(?:and\s+)?(?:tell\s+me\s+)?(?:about\s+)?|search\s+for\s+|look\s+up\s+(?:on\s+(?:the\s+)?web\s+)?|google\s+(?:for\s+)?|find\s+online\s+|check\s+online\s+for\s+)/i, '')
      .replace(/\b(?:and\s+stuff\s+like\s+that|you\s+have\s+access\s+to\s+it|on\s+its\s+own|for\s+me|please)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // If the query is an ambiguous pronoun follow-up (e.g. "what about their CEO?", "how does it work?", "what is its latest version?")
    const pronounMatch = cleaned.match(/\b(?:it|its|their|they|this|that|he|she)\b/i);
    if (pronounMatch && contextEntity && !cleaned.toLowerCase().includes(contextEntity.toLowerCase())) {
      cleaned = `${contextEntity} ${cleaned}`;
    }

    // If query is a generic follow-up (e.g. "search for it", "look it up", "find it", "what about it?")
    const isGenericFollowUp = /^(?:search\s+for\s+it|look\s+it\s+up|find\s+it|what\s+about\s+it|tell\s+me\s+more|search|search\s+the\s+web)$/i.test(cleaned);
    if (isGenericFollowUp) {
      if (contextEntity) return `${contextEntity} latest information`;
      if (contextLocation) return `${contextLocation} information`;
    }

    return cleaned || currentPrompt.slice(0, 120);
  },

  /**
   * Full intent analysis helper
   */
  analyzeIntent(
    query: string,
    webSearchToggle: boolean = true,
    chatHistory: Message[] = []
  ): IntentAnalysis {
    const isGreeting = this.isGreetingOrSocial(query);
    const needsSearch = this.shouldSearchWeb(query, webSearchToggle, chatHistory);
    const needsSkills = !isGreeting;
    const resolvedQuery = needsSearch ? this.resolveSearchQuery(query, chatHistory) : undefined;

    return {
      isGreetingOrSocial: isGreeting,
      needsWebSearch: needsSearch,
      needsSkills,
      searchReason: needsSearch ? 'Query requires real-time web grounding' : undefined,
      resolvedQuery,
    };
  },
};

