import { useEffect, useState } from 'react';
import { Message } from '../types';
import { countTokens, estimateTokensSync } from './tokenCounter';

/**
 * Returns an accurate token count for an assistant message's response body.
 *
 * Priority:
 *  1. `message.tokensEstimate` — computed once in App.tsx when the response
 *     finalizes (already accurate via the real BPE tokenizer). Avoids
 *     re-counting on every render.
 *  2. Otherwise counts `message.content` async with the real tokenizer,
 *     seeding with an instant heuristic so the number never flickers to 0.
 */
export function useMessageTokenCount(message: Message): number {
  const [count, setCount] = useState<number>(
    message.tokensEstimate ?? (message.content ? estimateTokensSync(message.content) : 0),
  );

  useEffect(() => {
    if (message.tokensEstimate !== undefined && message.tokensEstimate > 0) {
      setCount(message.tokensEstimate);
      return;
    }
    if (!message.content) {
      setCount(0);
      return;
    }
    let cancelled = false;
    setCount(estimateTokensSync(message.content));
    countTokens(message.content).then((n) => {
      if (!cancelled) setCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [message.content, message.tokensEstimate]);

  return count;
}
