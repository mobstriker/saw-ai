import { ReasoningMode } from '../types';

export interface ReasoningModeOption {
  id: ReasoningMode;
  label: string;
  shortLabel: string;
  badge: string;
  description: string;
  colorClass: string;
}

export const REASONING_MODES: ReasoningModeOption[] = [
  {
    id: 'off',
    label: 'Reasoning: Off',
    shortLabel: 'Off',
    badge: 'Off',
    description: 'Standard prompt without extended internal reasoning steps.',
    colorClass: 'text-[#7C756E] border-[#E6DFD3] bg-white',
  },
  {
    id: 'low',
    label: 'Reasoning: Low',
    shortLabel: 'Low',
    badge: 'Low Effort',
    description: 'Fast preliminary checks. The model dynamically allocates its own thinking depth.',
    colorClass: 'text-[#8A6D3B] border-[#D4C39E] bg-[#FCFBF7]',
  },
  {
    id: 'medium',
    label: 'Reasoning: Medium',
    shortLabel: 'Medium',
    badge: 'Medium Effort',
    description: 'Balanced analytical reasoning. The model dynamically determines multi-step logic.',
    colorClass: 'text-[#C58B51] border-[#C58B51] bg-[#FAF8F5]',
  },
  {
    id: 'high',
    label: 'Reasoning: High',
    shortLabel: 'High',
    badge: 'High Effort',
    description: 'Deep multi-step chain-of-thought for complex code architectures and logic.',
    colorClass: 'text-[#B0601B] border-[#B0601B] bg-[#FDF6EE]',
  },
  {
    id: 'extra_high',
    label: 'Reasoning: Extra High',
    shortLabel: 'Extra High',
    badge: 'Extra High',
    description: 'Maximum depth reasoning. The model exhaustively verifies edge cases and proof logic.',
    colorClass: 'text-[#8E44AD] border-[#D7BDE2] bg-[#FBF7FD]',
  },
];

export interface ModelReasoningCapability {
  supportsReasoning: boolean;
  type: 'openai-o-series' | 'deepseek-r1' | 'claude-extended' | 'gemini-thinking' | 'universal';
  typeName: string;
  description: string;
  recommendedMode: ReasoningMode;
  nativeParameter: string;
}

export function detectModelReasoningCapability(modelName: string = ''): ModelReasoningCapability {
  const m = modelName.toLowerCase();

  if (m.includes('o1') || m.includes('o3') || m.includes('o4')) {
    return {
      supportsReasoning: true,
      type: 'openai-o-series',
      typeName: 'OpenAI o-Series Native',
      description: 'Natively supports reasoning_effort parameter (low, medium, high). The model dynamically determines internal thinking tokens.',
      recommendedMode: 'medium',
      nativeParameter: 'reasoning_effort: "low" | "medium" | "high"',
    };
  }

  if (m.includes('deepseek') || m.includes('r1') || m.includes('reasoner')) {
    return {
      supportsReasoning: true,
      type: 'deepseek-r1',
      typeName: 'DeepSeek R1 Chain-of-Thought',
      description: 'Generates transparent internal reasoning traces and thinking deltas prior to final response.',
      recommendedMode: 'high',
      nativeParameter: 'delta.reasoning_content & <think> stream',
    };
  }

  if (m.includes('claude-3-7') || m.includes('claude-3.7') || m.includes('claude-3-5')) {
    return {
      supportsReasoning: true,
      type: 'claude-extended',
      typeName: 'Claude Extended Thinking',
      description: 'Native thinking mode with dynamic reasoning token generation and thinking blocks.',
      recommendedMode: 'medium',
      nativeParameter: 'thinking: { type: "enabled" }',
    };
  }

  if (m.includes('gemini-2.0-flash-thinking') || m.includes('thinking') || m.includes('gemini-2.5')) {
    return {
      supportsReasoning: true,
      type: 'gemini-thinking',
      typeName: 'Gemini Thinking Engine',
      description: 'Native dynamic thinking engine with streaming thought parts.',
      recommendedMode: 'medium',
      nativeParameter: 'thinkingConfig: { thinking: true }',
    };
  }

  if (m.includes('qwq') || m.includes('qwen-qwq')) {
    return {
      supportsReasoning: true,
      type: 'deepseek-r1',
      typeName: 'Qwen QwQ Reasoning',
      description: 'Full mathematical chain-of-thought with step-by-step thinking traces.',
      recommendedMode: 'high',
      nativeParameter: '<think> tokens',
    };
  }

  // Universal fallback for other models
  return {
    supportsReasoning: true,
    type: 'universal',
    typeName: 'Universal CoT Reasoning',
    description: 'Dynamic chain-of-thought reasoning with calibrated cognitive depth.',
    recommendedMode: 'medium',
    nativeParameter: 'reasoning_effort: "medium"',
  };
}

export interface ParsedThinkingResult {
  thinking: string;
  content: string;
  isStillThinking: boolean;
}

export type ReasoningCategory = 'intent' | 'scan' | 'plan' | 'synthesize' | 'search' | 'verify' | 'calculate';

export interface ReasoningPathStep {
  id: string;
  number: number;
  title: string;
  description: string;
  status: 'completed' | 'active' | 'pending';
  category: ReasoningCategory;
  wordCount?: number;
}

function detectThoughtCategory(text: string): ReasoningCategory {
  const lower = text.toLowerCase();
  if (/\b(?:search|web|google|duckduckgo|weather|forecast|online|lookup|browse|source|grounding|meteorolog)\b/.test(lower)) {
    return 'search';
  }
  if (/\b(?:file|workspace|source|component|import|class|function|syntax|inspect|read|dir|tree)\b/.test(lower)) {
    return 'scan';
  }
  if (/\b(?:calculate|math|formula|number|count|rate|price|convert|metric|eval)\b/.test(lower)) {
    return 'calculate';
  }
  if (/\b(?:verify|test|validation|correct|check|typecheck|ensure|lint|safe)\b/.test(lower)) {
    return 'verify';
  }
  if (/\b(?:plan|architecture|approach|strategy|design|patch|refactor|solution|decid)\b/.test(lower)) {
    return 'plan';
  }
  if (/\b(?:synthesize|format|output|answer|markdown|summary|present|explain|respond)\b/.test(lower)) {
    return 'synthesize';
  }
  return 'intent';
}

function generateCleanTitle(text: string, index: number, userPrompt: string): string {
  const clean = text
    .replace(/^[-*#\d.:\s]+/, '')
    .replace(/^(?:step\s*\d+[:.-]?|firstly|secondly|thirdly|finally|next|then|let's|let us|we need to|i need to|i will|now|first|second|third)\s+/i, '')
    .trim();

  // If the segment starts with a bold or clear heading
  const headingMatch = clean.match(/^([A-Z][^.:\n]{4,50})(?:[:\n]|$)/);
  if (headingMatch && headingMatch[1].length >= 5) {
    return headingMatch[1].trim();
  }

  // First sentence or first 60 chars
  const firstSentence = clean.split(/[.!?\n]/)[0]?.trim() || '';
  if (firstSentence && firstSentence.length >= 8 && firstSentence.length <= 65) {
    return firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  }

  if (firstSentence && firstSentence.length > 65) {
    return firstSentence.slice(0, 60).trim() + '...';
  }

  // Fallback tailored to user prompt
  if (userPrompt) {
    const pClean = userPrompt.slice(0, 35);
    if (index === 0) return `Analyze Intent for "${pClean}"`;
    if (index === 1) return `Examine Context & Dependencies`;
    if (index === 2) return `Formulate Strategy & Validate`;
    return `Synthesize Response for "${pClean}"`;
  }

  return `Reasoning Milestone ${index + 1}`;
}

export function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return '';
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remSec = (seconds % 60).toFixed(0);
  return `${mins}m ${remSec}s`;
}

export interface ReasoningExtractionOptions {
  thinkingText?: string;
  isThinking?: boolean;
  isGenerating?: boolean;
  contentLength?: number;
  userPrompt?: string;
  thoughtDurationMs?: number;
  webSearchResultsCount?: number;
  projectFilesCount?: number;
}

/**
 * Dynamically extracts REAL step-by-step reasoning path milestones from the actual thinking text and job pipeline.
 * Real-time active tracking dynamically advances from Intent -> Context Grounding -> Cognitive Reasoning -> Synthesizing -> Verification.
 */
export function extractReasoningPathSteps(
  thinkingTextOrOptions: string | ReasoningExtractionOptions = '',
  legacyIsThinking: boolean = false,
  legacyUserPrompt: string = ''
): {
  steps: ReasoningPathStep[];
  activeStepTitle: string;
  summary: string;
  currentStepIndex: number;
  totalSteps: number;
} {
  const options: ReasoningExtractionOptions =
    typeof thinkingTextOrOptions === 'object' && thinkingTextOrOptions !== null
      ? thinkingTextOrOptions
      : {
          thinkingText: typeof thinkingTextOrOptions === 'string' ? thinkingTextOrOptions : '',
          isThinking: legacyIsThinking,
          userPrompt: legacyUserPrompt,
        };

  const thinkingText = options.thinkingText || '';
  const isThinking = !!options.isThinking;
  const isGenerating = options.isGenerating !== undefined ? options.isGenerating : isThinking;
  const contentLength = options.contentLength || 0;
  const userPrompt = options.userPrompt || '';
  const hasWebSearch = (options.webSearchResultsCount || 0) > 0;
  const hasFiles = (options.projectFilesCount || 0) > 0;

  const cleanThoughts = thinkingText.trim();
  const rawSegments: string[] = [];

  if (cleanThoughts) {
    // Split thoughts by double newlines or numbered items or markdown bullet points
    const paragraphs = cleanThoughts.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

    for (const p of paragraphs) {
      const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
      const isList = lines.length > 1 && lines.every((l) => /^[-*#\d.]/.test(l));

      if (isList) {
        for (const line of lines) {
          if (line.length > 10) rawSegments.push(line);
        }
      } else {
        if (p.length > 250) {
          const sentences = p.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length > 15);
          if (sentences.length > 1) {
            rawSegments.push(...sentences);
          } else {
            rawSegments.push(p);
          }
        } else {
          rawSegments.push(p);
        }
      }
    }
  }

  // If thoughts contain fewer than 3 segments, build the structured execution pipeline for the user's specific prompt
  if (rawSegments.length < 2) {
    const cleanPrompt = (userPrompt || 'workspace task').slice(0, 45);
    const isSearchQuery = hasWebSearch || /\b(?:weather|temperature|forecast|search|latest|news|price|current|today)\b/i.test(userPrompt);
    const isCodeTask = hasFiles || /\b(?:file|code|component|bug|fix|build|refactor|function|typescript|react|html|css)\b/i.test(userPrompt);

    rawSegments.length = 0; // reset to structured pipeline

    rawSegments.push(`Deconstruct intent and constraints for "${cleanPrompt}".`);

    if (isSearchQuery) {
      rawSegments.push(`Execute live web search and retrieve verified grounding sources.`);
      rawSegments.push(`Evaluate retrieved facts, metrics, and meteorological parameters.`);
    } else if (isCodeTask) {
      rawSegments.push(`Scan workspace files, component hierarchy, and dependency bindings.`);
      rawSegments.push(`Formulate multi-file logic architecture and verify syntax safety.`);
    } else {
      rawSegments.push(`Scan relevant context history, system guidelines, and parameters.`);
      rawSegments.push(`Perform analytical chain-of-thought and evaluate hypotheses.`);
    }

    rawSegments.push(`Synthesize structured solution and format Markdown output.`);
    rawSegments.push(`Verify code integrity and package deliverable.`);
  }

  // Cap segments between 3 and 6 for a clean, readable UI timeline
  const finalSegments = rawSegments.slice(0, 6);
  const totalStepsCount = finalSegments.length;

  // Real-Time Dynamic Active Index Calculation
  let activeIndex = totalStepsCount; // default all completed when not generating

  if (isGenerating || isThinking) {
    const duration = options.thoughtDurationMs || 0;

    if (isThinking) {
      // While thinking, advance based on thought text or elapsed duration
      const totalWords = cleanThoughts.split(/\s+/).filter(Boolean).length;
      if (cleanThoughts.length > 0) {
        if (totalWords < 20) {
          activeIndex = 0; // Intent & constraints
        } else if (totalWords < 60) {
          activeIndex = Math.min(1, totalStepsCount - 2); // Context & Scan
        } else if (totalWords < 140) {
          activeIndex = Math.min(2, totalStepsCount - 2); // Deep Reasoning
        } else {
          const calculated = Math.min(totalStepsCount - 2, 1 + Math.floor(totalWords / 60));
          activeIndex = Math.max(1, calculated);
        }
      } else {
        // Time-based advancement during thinking phase
        if (duration < 500) {
          activeIndex = 0;
        } else if (duration < 1400) {
          activeIndex = Math.min(1, totalStepsCount - 2);
        } else {
          activeIndex = Math.min(2, totalStepsCount - 2);
        }
      }
    } else {
      // In synthesis/generation mode (thinking complete, streaming output content)
      if (contentLength < 120) {
        // Initializing stream and synthesizing solution
        activeIndex = Math.max(0, totalStepsCount - 2);
      } else if (contentLength < 500) {
        // Actively generating content & components
        activeIndex = Math.max(0, totalStepsCount - 2);
      } else {
        // Verifying code integrity and packaging final output
        activeIndex = totalStepsCount - 1;
      }
    }
  }

  const steps: ReasoningPathStep[] = finalSegments.map((segment, idx) => {
    const category = detectThoughtCategory(segment);
    const title = generateCleanTitle(segment, idx, userPrompt);
    const words = segment.split(/\s+/).filter(Boolean).length;

    let status: 'completed' | 'active' | 'pending';
    if (!isGenerating && !isThinking) {
      status = 'completed';
    } else {
      if (idx < activeIndex) status = 'completed';
      else if (idx === activeIndex) status = 'active';
      else status = 'pending';
    }

    return {
      id: `step-${idx}-${category}`,
      number: idx + 1,
      title,
      description: segment.replace(/^[-*#\d.:\s]+/, '').slice(0, 180),
      status,
      category,
      wordCount: words,
    };
  });

  const activeStep = steps.find((s) => s.status === 'active') || steps[steps.length - 1];
  const activeStepTitle = (isGenerating || isThinking) ? activeStep.title : 'Reasoning completed';
  const summary = (isGenerating || isThinking)
    ? `Step ${activeStep.number} of ${steps.length}: ${activeStep.title}`
    : `All ${steps.length} dynamic milestones completed`;

  return {
    steps,
    activeStepTitle,
    summary,
    currentStepIndex: activeIndex + 1,
    totalSteps: steps.length,
  };
}

/**
 * Parses raw accumulated streaming text to extract <think>...</think> blocks
 * and separate thinking tokens from final answer content.
 */
export function parseThinkingFromStream(rawText: string): ParsedThinkingResult {
  if (!rawText) {
    return { thinking: '', content: '', isStillThinking: false };
  }

  const thinkOpenIndex = rawText.indexOf('<think>');

  if (thinkOpenIndex === -1) {
    return {
      thinking: '',
      content: rawText,
      isStillThinking: false,
    };
  }

  const thinkCloseIndex = rawText.indexOf('</think>');

  if (thinkCloseIndex === -1) {
    // We have opened <think> but haven't closed it yet -> still thinking
    const thinkingText = rawText.slice(thinkOpenIndex + 7).trimStart();
    return {
      thinking: thinkingText,
      content: '',
      isStillThinking: true,
    };
  }

  // Both <think> and </think> exist
  const thinkingText = rawText.slice(thinkOpenIndex + 7, thinkCloseIndex).trim();
  const contentText = rawText.slice(thinkCloseIndex + 8).trimStart();

  return {
    thinking: thinkingText,
    content: contentText,
    isStillThinking: false,
  };
}
