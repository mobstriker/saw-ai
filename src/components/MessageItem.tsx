import React, { useState } from 'react';
import {
  Copy,
  Check,
  Sparkles,
  Globe,
  User,
  ExternalLink,
  Code,
  Brain,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  MessageSquare,
  HelpCircle,
  Settings,
  AlertTriangle,
  Send,
  CheckCircle2,
  Zap,
  RotateCw,
  Play,
  Clock,
  Undo2,
} from 'lucide-react';
import { Message, Artifact, ProjectFile } from '../types';
import { formatDuration } from '../utils/reasoning';
import { MarkdownRenderer } from '../utils/markdownRenderer';
import { PatchChunk } from '../utils/patchApplier';
import { ReasoningPathViewer } from './ReasoningPathViewer';
import { useMessageTokenCount } from '../utils/useMessageTokenCount';

interface MessageItemProps {
  message: Message;
  userPrompt?: string;
  isLastMessage?: boolean;
  isGenerating?: boolean;
  onContinue?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  onImplementCode?: (code: string, language: string, suggestedPath: string) => void;
  onClarificationAnswer?: (answer: string) => void;
  onAcceptArtifacts?: (messageId: string, artifacts: Artifact[]) => void;
  onRejectArtifacts?: (messageId: string) => void;
  onOpenSettings?: () => void;
  onApplyPatch?: (patch: PatchChunk) => void;
  onRevertPatch?: (patch: PatchChunk) => void;
  onRestore?: (messageId: string) => void;
  targetFile?: ProjectFile | null;
  targetArtifact?: Artifact | null;
}

// Memoized so a finished message whose props are unchanged does not re-render
// when another message (e.g. the streaming one) updates. The custom comparator
// checks only the fields that actually affect output; callbacks are expected to
// be referentially stable (useCallback) from the parent.
export const MessageItem: React.FC<MessageItemProps> = React.memo(({
  message,
  userPrompt,
  isLastMessage,
  isGenerating,
  onContinue,
  onRetry,
  onOpenArtifact,
  onImplementCode,
  onClarificationAnswer,
  onAcceptArtifacts,
  onRejectArtifacts,
  onOpenSettings,
  onApplyPatch,
  onRevertPatch,
  onRestore,
  targetFile,
  targetArtifact,
}) => {
  const [clarificationText, setClarificationText] = useState('');
  const requests = message.clarificationRequests || [];
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(message.clarificationAnswers?.length || 0);
  const [answers, setAnswers] = useState<string[]>(message.clarificationAnswers?.map(a => a.answer) || []);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  // Accurate token count for this response (BPE tokenizer). For assistant
  // messages this is the per-response token spend shown at the end of the box.
  const responseTokenCount = useMessageTokenCount(message);

  const isClarificationFinished = requests.length > 0 && answers.length >= requests.length;
  const currentRequest = requests[currentQuestionIndex];

  // Clean content to avoid showing raw JSON or markdown code snippets for clarifications
  const displayContent = React.useMemo(() => {
    if (!message.content) return '';
    let text = message.content;

    // Strip json code blocks containing clarification_requests
    text = text.replace(/```(?:json)?\s*\{[\s\S]*?"(?:clarification_requests?|options)"[\s\S]*?\}\s*```/gi, '');

    // Strip standalone clarification json objects
    text = text.replace(/\{[\s\S]*?"(?:clarification_requests?)"[\s\S]*?\}/gi, '');

    // If clarification requests exist, strip the raw text question/options pattern so it only renders in the card
    if (requests.length > 0) {
      text = text.replace(/(?:(?:\*{0,2}Clarification\s+Request[s]?\*{0,2}:?|\*{0,2}Clarification\s+Question[s]?\*{0,2}:?)\s*\n)?\*{0,2}Question\*{0,2}:?\s*[^\n]+\s*\n\*{0,2}Options\*{0,2}:?\s*\n(?:(?:\s*[-*•]|\s*[A-Da-d0-9][.)])\s*[^\n]+\s*\n?)+/gi, '');
    }

    return text.trim();
  }, [message.content, requests.length]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedTime = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isErrorMessage = Boolean(message.isError);
  const isApiKeyRequiredError =
    isErrorMessage &&
    (message.content.includes('API Key Configuration Required') ||
      message.content.includes('No API Key') ||
      message.content.includes('401') ||
      message.content.includes('Unauthorized'));

  const submitAnswer = (ans: string) => {
    const newAnswers = [...answers, ans];
    setAnswers(newAnswers);

    if (newAnswers.length >= requests.length) {
      if (onClarificationAnswer) {
        const finalText = newAnswers.map((a, i) => `Q: ${requests[i].question}\nA: ${a}`).join('\n\n');
        onClarificationAnswer(finalText);
      }
    } else {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setClarificationText('');
    }
  };

  const handleOptionClick = (opt: string, letter: string) => {
    const formattedAnswer = `${opt} (Option ${letter})`;
    submitAnswer(formattedAnswer);
  };

  const handleCustomClarificationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (clarificationText.trim()) {
      submitAnswer(clarificationText.trim());
    }
  };

  return (
    <div
      className={`flex flex-col gap-2 group transition-all animate-in fade-in duration-200 ${
        isUser ? 'items-end' : 'items-start'
      }`}
    >
      {/* Header with Avatar & Time */}
      <div className="flex items-center gap-2 px-1">
        {isUser ? (
          <>
            <span className="text-[10px] text-[#A09890]">{formattedTime}</span>
            <span className="text-xs font-bold text-[#2C2825]">You</span>
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#E6DFD3] text-[10px] font-bold text-[#2C2825]">
              US
            </div>
          </>
        ) : (
          <>
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#C58B51] text-[10px] font-bold text-white shadow-2xs">
              AI
            </div>
            <span className="text-xs font-bold text-[#2C2825]">Assistant</span>
            {message.modelUsed && (
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#E6DFD3] text-[#7C756E]" title={`Model: ${message.modelUsed}`}>
                ⚡ {message.modelUsed.includes('/') ? message.modelUsed.split('/').pop() : message.modelUsed}
              </span>
            )}
            {message.reasoningMode && message.reasoningMode !== 'off' && (
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#C58B51]/30 text-[#C58B51] uppercase">
                {message.reasoningMode.replace('_', ' ')} Reasoning
              </span>
            )}
            {message.content && (message.content.includes('<<<<<<< SEARCH') || message.content.includes('<<<< SEARCH')) && (
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-[#F5E6D3] border border-[#C58B51]/40 text-[#C58B51] flex items-center gap-1">
                <Zap size={9} />
                <span>Targeted Edit (Tokens Saved)</span>
              </span>
            )}
            <span className="text-[10px] text-[#A09890]">{formattedTime}</span>
            {message.generationDurationMs !== undefined && message.generationDurationMs > 0 && (
              <span className="text-[10px] font-mono text-[#C58B51] flex items-center gap-1 bg-[#FAF8F5] px-1.5 py-0.5 rounded border border-[#E6DFD3]" title={`Generation completed in ${formatDuration(message.generationDurationMs)}`}>
                <Clock size={10} />
                <span>{formatDuration(message.generationDurationMs)}</span>
              </span>
            )}
          </>
        )}
      </div>

      {/* Web Search Sources Pill (if web search was grounded) */}
      {message.searchResults && message.searchResults.length > 0 && (
        <div className="w-full max-w-2xl p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#C58B51]">
            <Globe size={13} />
            <span>Web Search Grounding ({message.searchResults.length} sources)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {message.searchResults.map((res, i) => (
              <a
                key={i}
                href={res.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E6DFD3] text-[10px] text-[#7C756E] hover:text-[#2C2825] hover:border-[#C58B51] transition-all"
              >
                <span className="truncate max-w-[160px] font-medium">{res.title}</span>
                <ExternalLink size={9} />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Main Message Bubble */}
      <div
        className={`relative w-full max-w-2xl rounded-2xl p-4.5 transition-all ${
          isUser
            ? 'bg-[#F5F1EA] text-[#2C2825] border border-[#E6DFD3] rounded-tr-xs'
            : isErrorMessage
            ? 'bg-[#FFF9F5] text-[#2C2825] border-2 border-[#C58B51]/60 rounded-tl-xs shadow-xs'
            : 'bg-white text-[#2C2825] border border-[#E6DFD3] rounded-tl-xs shadow-2xs'
        }`}
      >
        {/* Claude-Style Step-by-Step Reasoning Path Viewer (hides fast word stream in favor of visual path) */}
        {(message.thinkingContent || message.isThinking || (isGenerating && !isUser)) && (
          <ReasoningPathViewer
            thinkingContent={message.thinkingContent}
            isThinking={message.isThinking}
            isGenerating={isGenerating}
            contentLength={message.content?.length || 0}
            userPrompt={userPrompt || (message.role === 'user' ? message.content : '')}
            thoughtDurationMs={message.thoughtDurationMs}
            generationDurationMs={message.generationDurationMs}
            reasoningMode={message.reasoningMode}
            webSearchResultsCount={message.searchResults?.length || 0}
          />
        )}

        {/* Error Notification Card with Direct Settings CTA */}
        {isApiKeyRequiredError && (
          <div className="mb-3.5 p-3.5 rounded-xl bg-[#FAF8F5] border border-[#C58B51]/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#C58B51]/15 text-[#C58B51] flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle size={16} />
              </div>
              <div className="space-y-0.5">
                <h4 className="text-xs font-bold text-[#2C2825]">API Key Configuration Required</h4>
                <p className="text-[11px] text-[#7C756E] leading-relaxed">
                  Provide your API key in settings to start communicating with upstream models directly.
                </p>
              </div>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C58B51] hover:bg-[#B0783F] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer"
              >
                <Settings size={13} />
                <span>Open Settings</span>
              </button>
            )}
          </div>
        )}

        {/* Assistant Response Content */}
        {displayContent ? (
          <MarkdownRenderer
            content={displayContent}
            onOpenArtifact={onOpenArtifact}
            onImplementCode={onImplementCode}
            onApplyPatch={onApplyPatch}
            onRevertPatch={onRevertPatch}
            targetFile={targetFile}
            targetArtifact={targetArtifact}
          />
        ) : message.isThinking ? (
          <div className="flex items-center gap-2 py-1 text-xs text-[#7C756E] italic font-sans">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C58B51] animate-pulse"></span>
            <span>Synthesizing answer from reasoning...</span>
          </div>
        ) : null}

        {/* Claude-Style Interactive Clarification Card */}
        {requests.length > 0 && (
          <div className="mt-3.5 p-4 rounded-2xl border-2 border-[#C58B51]/50 bg-[#FAF8F5] shadow-xs space-y-3.5 animate-in fade-in duration-200">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center shrink-0 shadow-2xs">
                <HelpCircle size={17} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-[#C58B51] uppercase tracking-wider">
                    {isClarificationFinished
                      ? 'Clarification Provided'
                      : `Clarification Requested ${requests.length > 1 ? `(${currentQuestionIndex + 1} of ${requests.length})` : ''}`}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-white text-[#7C756E] border border-[#E6DFD3] font-medium">
                    {isClarificationFinished ? 'Complete' : 'Select Option or Type Custom'}
                  </span>
                </div>
                {!isClarificationFinished && currentRequest && (
                  <h3 className="text-sm font-bold text-[#2C2825] mt-1 leading-snug">
                    {currentRequest.question}
                  </h3>
                )}
                {isClarificationFinished && (
                  <p className="text-xs text-[#7C756E] mt-1">
                    Your answers were submitted. The AI is proceeding with your specifications.
                  </p>
                )}
              </div>
            </div>

            {/* Selectable Option Cards / Pills */}
            {!isClarificationFinished && currentRequest?.options && currentRequest.options.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {currentRequest.options.map((opt, optIdx) => {
                  const letter = String.fromCharCode(65 + optIdx); // A, B, C, D...
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => handleOptionClick(opt, letter)}
                      className="flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all text-xs cursor-pointer group shadow-2xs hover:shadow-xs active:scale-[0.99] bg-white border-[#E6DFD3] hover:border-[#C58B51] hover:bg-[#FAF8F5] text-[#4A443F]"
                    >
                      <span className="w-5 h-5 rounded-lg border flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors bg-[#FAF8F5] group-hover:bg-[#C58B51] group-hover:text-white border-[#E6DFD3] group-hover:border-[#C58B51] text-[#7C756E]">
                        {letter}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="leading-relaxed font-semibold block">{opt}</span>
                        <span className="text-[10px] text-[#A09890] mt-0.5 block group-hover:text-[#C58B51]">
                          Click to choose Option {letter}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Custom Clarification Text Input Box */}
            {!isClarificationFinished && (
              <div className="pt-2 border-t border-[#E6DFD3]/80 space-y-1.5">
                <span className="text-[11px] font-medium text-[#7C756E]">
                  Or specify custom clarification / details:
                </span>
                <form onSubmit={handleCustomClarificationSubmit} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={clarificationText}
                    onChange={(e) => setClarificationText(e.target.value)}
                    placeholder="Type your clarification or custom requirements..."
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-[#E6DFD3] bg-white text-[#2C2825] placeholder-[#A09890] focus:outline-none focus:border-[#C58B51] shadow-2xs"
                  />
                  <button
                    type="submit"
                    disabled={!clarificationText.trim()}
                    className="flex items-center gap-1 px-3.5 py-2 text-xs font-bold rounded-xl bg-[#C58B51] text-white hover:bg-[#B0783F] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs cursor-pointer"
                  >
                    <Send size={11} />
                    <span>{requests.length > 1 && currentQuestionIndex < requests.length - 1 ? 'Next' : 'Send'}</span>
                  </button>
                </form>
              </div>
            )}

            {/* Answered State Confirmation */}
            {isClarificationFinished && (
              <div className="flex flex-col gap-2 pt-2 border-t border-[#E6DFD3]/80">
                {answers.map((ans, idx) => (
                  <div key={idx} className="flex flex-col gap-1 text-[11px] bg-white p-2.5 rounded-xl border border-[#E6DFD3]">
                    <span className="text-[#7C756E] font-medium">Q{idx + 1}: {requests[idx]?.question || 'Question'}</span>
                    <div className="flex items-start gap-1.5 text-[#C58B51] font-bold">
                      <CheckCircle2 size={13} className="text-[#C58B51] shrink-0 mt-0.5" />
                      <span>Answer: {ans}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mid-Prompt Cutoff / Interruption Notification Card with Continue & Retry */}
        {message.isStopped && !isGenerating && (
          <div className="mt-3.5 p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0 animate-pulse"></span>
              <div>
                <span className="text-xs font-bold text-[#2C2825] block">
                  Response paused or cut off mid-prompt
                </span>
                <span className="text-[11px] text-[#7C756E]">
                  Click Continue to resume seamlessly or Retry to regenerate.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {onContinue && (
                <button
                  type="button"
                  onClick={() => onContinue(message.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-white text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95"
                  title="Continue generating seamlessly from where it stopped"
                >
                  <Play size={12} className="fill-white" />
                  <span>Continue</span>
                </button>
              )}
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(message.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-[#FAF8F5] text-[#2C2825] border border-[#E6DFD3] text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95"
                  title="Regenerate this response from scratch"
                >
                  <RotateCw size={12} />
                  <span>Retry</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Connection Error Notification Card with Retry */}
        {message.isError && !message.isStopped && onRetry && (
          <div className="mt-3 p-3 rounded-xl bg-[#FAF8F5] border border-rose-200 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-rose-800">
              An error occurred during generation.
            </span>
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-white text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95 shrink-0"
            >
              <RotateCw size={12} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Bottom hover / action tools */}
        <div className="mt-2 pt-2 border-t border-[#E6DFD3]/60 flex items-center justify-between text-[10px] text-[#A09890]">
          <div className="flex items-center gap-2">
            <span title="Accurate token count for this response (real BPE tokenizer)">
              ~{responseTokenCount.toLocaleString()} tokens
            </span>
            {message.modelUsed && (
              <>
                <span>•</span>
                <span className="font-mono text-[9px] text-[#7C756E]">{message.modelUsed}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Continue Button on assistant message */}
            {onContinue && !isGenerating && message.content && (
              <button
                type="button"
                onClick={() => onContinue(message.id)}
                className="flex items-center gap-1 text-[#C58B51] hover:text-[#B0783F] px-2 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E6DFD3] transition-all cursor-pointer font-medium"
                title="Continue generating seamlessly from where it left off"
              >
                <Play size={10} className="fill-[#C58B51]" />
                <span>Continue</span>
              </button>
            )}

            {/* Retry Button on completed assistant message */}
            {onRetry && !message.isStopped && !isGenerating && (
              <button
                type="button"
                onClick={() => onRetry(message.id)}
                className="flex items-center gap-1 text-[#7C756E] hover:text-[#2C2825] px-2 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E6DFD3] transition-all cursor-pointer"
                title="Regenerate this response"
              >
                <RotateCw size={11} />
                <span>Retry</span>
              </button>
            )}

            {/* Restore Button — reverts project files to the snapshot captured
                before this response's changes were applied (per-response undo).
                Only shown on assistant messages that actually modified a
                project. The Continue button above is intentionally untouched. */}
            {onRestore && !isGenerating && message.projectSnapshotBefore && (
              <button
                type="button"
                onClick={() => onRestore(message.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all cursor-pointer ${
                  message.restoredAt
                    ? 'text-emerald-600 border-emerald-200 bg-emerald-50'
                    : 'text-[#7C756E] hover:text-[#2C2825] border-transparent hover:bg-[#FAF8F5] hover:border-[#E6DFD3]'
                }`}
                title={
                  message.restoredAt
                    ? 'Project restored to before this response. Click again to re-restore.'
                    : 'Restore project files to how they were before this response'
                }
              >
                <Undo2 size={11} />
                <span>{message.restoredAt ? 'Restored' : 'Restore'}</span>
              </button>
            )}

            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-[#7C756E] hover:text-[#2C2825] px-2 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E6DFD3] transition-all cursor-pointer"
              title="Copy message content"
            >
              {copied ? (
                <>
                  <Check size={11} className="text-emerald-600" />
                  <span className="text-emerald-600">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  // Custom comparator: re-render only when something that affects output
  // changed. Referentially-stable callbacks (useCallback) are assumed, so we
  // don't compare them — comparing them would be cheap but redundant.
  const pm = prev.message;
  const nm = next.message;
  if (pm.id !== nm.id) return false;
  if (pm.content !== nm.content) return false;
  if (pm.thinkingContent !== nm.thinkingContent) return false;
  if (pm.isThinking !== nm.isThinking) return false;
  if (pm.isStopped !== nm.isStopped) return false;
  if (pm.isError !== nm.isError) return false;
  if (pm.artifactsState !== nm.artifactsState) return false;
  if (pm.clarificationRequests !== nm.clarificationRequests) return false;
  if (pm.searchResults !== nm.searchResults) return false;
  if (pm.modelUsed !== nm.modelUsed) return false;
  if (pm.generationDurationMs !== nm.generationDurationMs) return false;
  if (pm.tokensEstimate !== nm.tokensEstimate) return false;
  if (pm.restoredAt !== nm.restoredAt) return false;
  // Restore button visibility depends on whether a snapshot exists; re-render
  // when that presence flips (the snapshot is attached in a separate update
  // after the message is finalized, so the comparator must catch the change).
  if (Boolean(pm.projectSnapshotBefore) !== Boolean(nm.projectSnapshotBefore)) return false;
  if (prev.userPrompt !== next.userPrompt) return false;
  if (prev.isLastMessage !== next.isLastMessage) return false;
  if (prev.isGenerating !== next.isGenerating) return false;
  if (prev.targetFile !== next.targetFile) return false;
  if (prev.targetArtifact !== next.targetArtifact) return false;
  return true;
});


