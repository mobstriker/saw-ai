/**
 * Accurate token counter backed by `gpt-tokenizer` (a pure-JS port of
 * OpenAI's tiktoken BPE). The default export encodes with the o200k_base
 * encoding used by GPT-4o / GPT-4.1 — a good approximation for any modern
 * sub-word tokenizer (Claude, Gemini, etc. all use similar BPE schemes).
 *
 * Results are memoized (LRU, capped) because the same prompt text is counted
 * on every keystroke in the prompt footer.
 */

let encoderReady: Promise<boolean> | null = null;
let encodeFn: ((text: string) => number[]) | null = null;

async function loadEncoder(): Promise<boolean> {
  if (encodeFn) return true;
  if (!encoderReady) {
    encoderReady = (async () => {
      try {
        const mod = await import('gpt-tokenizer');
        if (typeof mod.encode === 'function') {
          encodeFn = mod.encode;
          return true;
        }
        return false;
      } catch (err) {
        console.warn('[tokenCounter] gpt-tokenizer unavailable, falling back to heuristic:', err);
        return false;
      }
    })();
  }
  return encoderReady;
}

// Kick off the load eagerly so the first count is fast.
loadEncoder();

const cache = new Map<string, number>();
const CACHE_MAX = 512;

function heuristic(text: string): number {
  if (!text) return 0;
  // ~3.6 chars/token is the empirical mean for mixed English+code under BPE.
  return Math.ceil(text.length / 3.6);
}

/**
 * Count tokens for a string using the real BPE tokenizer when available.
 * Returns a heuristic estimate only if the encoder failed to load.
 *
 * NOTE: this is async because the encoder is lazy-loaded; callers that already
 * have a sync hot path should use `estimateTokensSync` (heuristic) as a
 * placeholder and refresh with the accurate async result.
 */
export async function countTokens(text: string): Promise<number> {
  if (!text) return 0;
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  const ok = await loadEncoder();
  let count: number;
  if (ok && encodeFn) {
    try {
      count = encodeFn(text).length;
    } catch {
      count = heuristic(text);
    }
  } else {
    count = heuristic(text);
  }

  if (cache.size >= CACHE_MAX) {
    // Evict oldest entry (Map preserves insertion order).
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(text, count);
  return count;
}

/** Synchronous heuristic estimate (chars/3.6). Use only as an instant
 *  placeholder while the accurate async count resolves. */
export function estimateTokensSync(text: string): number {
  return heuristic(text);
}
