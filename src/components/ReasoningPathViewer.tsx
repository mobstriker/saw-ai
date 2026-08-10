import React, { useState, useEffect } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Sparkles,
  Search,
  FileCode,
  Layers,
  Terminal,
  Clock,
  ArrowRight,
  Calculator,
  ShieldCheck,
  Globe,
  Loader2,
} from 'lucide-react';
import {
  extractReasoningPathSteps,
  formatDuration,
  ReasoningPathStep,
  ReasoningCategory,
} from '../utils/reasoning';

interface ReasoningPathViewerProps {
  thinkingContent?: string;
  isThinking?: boolean;
  isGenerating?: boolean;
  contentLength?: number;
  userPrompt?: string;
  thoughtDurationMs?: number;
  generationDurationMs?: number;
  reasoningMode?: string;
  webSearchResultsCount?: number;
  projectFilesCount?: number;
}

export const ReasoningPathViewer: React.FC<ReasoningPathViewerProps> = ({
  thinkingContent = '',
  isThinking = false,
  isGenerating = false,
  contentLength = 0,
  userPrompt = '',
  thoughtDurationMs,
  generationDurationMs,
  reasoningMode,
  webSearchResultsCount = 0,
  projectFilesCount = 0,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRawLogs, setShowRawLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number>(0);

  const isLive = isThinking || isGenerating;

  // Live timer while thinking or generating
  useEffect(() => {
    if (!isLive) {
      setLiveElapsedMs(0);
      return;
    }
    const startTime = Date.now();
    const timer = setInterval(() => {
      setLiveElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(timer);
  }, [isLive]);

  const { steps, activeStepTitle, summary, currentStepIndex, totalSteps } = extractReasoningPathSteps({
    thinkingText: thinkingContent,
    isThinking,
    isGenerating,
    contentLength,
    userPrompt,
    thoughtDurationMs: isLive ? liveElapsedMs : (thoughtDurationMs || generationDurationMs),
    webSearchResultsCount,
    projectFilesCount,
  });

  const progressPercentage = isLive
    ? Math.min(95, Math.round((currentStepIndex / Math.max(1, totalSteps)) * 100))
    : 100;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (thinkingContent) {
      navigator.clipboard.writeText(thinkingContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const effectiveDuration = (isLive ? liveElapsedMs : undefined) || generationDurationMs || thoughtDurationMs;
  const formattedDuration = formatDuration(effectiveDuration);

  const getStepIcon = (category: ReasoningCategory, status: 'completed' | 'active' | 'pending') => {
    if (status === 'completed') {
      return <Check size={11} className="text-[#C58B51] stroke-[2.5]" />;
    }
    if (status === 'active') {
      return <span className="w-2 h-2 rounded-full bg-[#C58B51] animate-ping" />;
    }
    switch (category) {
      case 'intent':
        return <Sparkles size={10} className="text-[#A09890]" />;
      case 'scan':
        return <Search size={10} className="text-[#A09890]" />;
      case 'search':
        return <Globe size={10} className="text-[#A09890]" />;
      case 'plan':
        return <FileCode size={10} className="text-[#A09890]" />;
      case 'calculate':
        return <Calculator size={10} className="text-[#A09890]" />;
      case 'verify':
        return <ShieldCheck size={10} className="text-[#A09890]" />;
      case 'synthesize':
        return <Layers size={10} className="text-[#A09890]" />;
      default:
        return <span className="w-1.5 h-1.5 rounded-full bg-[#D5CEC5]" />;
    }
  };

  return (
    <div
      id="reasoning-path-container"
      className="mb-3.5 rounded-2xl border border-[#E6DFD3] bg-[#FAF8F5] text-xs transition-all overflow-hidden shadow-2xs font-sans"
    >
      {/* Header Bar */}
      <div
        id="reasoning-path-header"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-[#F5F1EA]/70 transition-colors select-none group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-white border border-[#E6DFD3] text-[#C58B51] shadow-2xs ${isLive ? 'ring-2 ring-[#C58B51]/30 animate-pulse' : ''}`}>
            {isLive ? (
              <Brain size={13} className="text-[#C58B51]" />
            ) : (
              <Brain size={13} className="text-[#C58B51]" />
            )}
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-[11px] text-[#2C2825] shrink-0">
              {isLive ? 'Live Reasoning Pipeline' : 'Thought Process'}
            </span>

            {isLive ? (
              <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[#C58B51] font-medium truncate">
                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <span className="w-1 h-1 rounded-full bg-[#C58B51] animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1 h-1 rounded-full bg-[#C58B51] animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1 h-1 rounded-full bg-[#C58B51] animate-bounce"></span>
                </span>
                <span className="font-mono text-[10px] text-[#B0601B] font-bold bg-[#FDF6EE] px-1.5 py-0.2 rounded border border-[#B0601B]/20">
                  Step {currentStepIndex}/{totalSteps}
                </span>
                <span className="truncate text-[#7C756E] hidden sm:inline">
                  {activeStepTitle}
                </span>
                {formattedDuration && (
                  <span className="text-[10px] font-mono text-[#C58B51] shrink-0">
                    ({formattedDuration})
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-[#7C756E] font-medium shrink-0">
                <span className="px-1.5 py-0.5 rounded-md bg-white border border-[#E6DFD3] text-[#7C756E]">
                  {steps.length} milestones completed
                </span>
                {formattedDuration && (
                  <span className="flex items-center gap-0.5 text-[#A09890]">
                    <Clock size={10} />
                    {formattedDuration}
                  </span>
                )}
                {reasoningMode && reasoningMode !== 'off' && (
                  <span className="text-[9px] font-bold text-[#C58B51] uppercase font-mono hidden sm:inline">
                    {reasoningMode}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {!isExpanded ? (
            <span className="text-[10px] text-[#C58B51] font-semibold flex items-center gap-1 bg-white px-2 py-0.5 rounded-lg border border-[#E6DFD3] group-hover:border-[#C58B51] transition-all shadow-2xs">
              <span>View path</span>
              <ChevronDown size={11} />
            </span>
          ) : (
            <span className="text-[10px] text-[#7C756E] font-semibold flex items-center gap-1 bg-white px-2 py-0.5 rounded-lg border border-[#E6DFD3] group-hover:border-[#2C2825] transition-all shadow-2xs">
              <span>Collapse</span>
              <ChevronUp size={11} />
            </span>
          )}
        </div>
      </div>

      {/* Real-time Progress Bar */}
      {isLive && (
        <div className="w-full bg-[#E6DFD3]/40 h-1 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#C58B51] to-[#B0601B] transition-all duration-300 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      )}

      {/* Collapsed Single-Line Milestone Status with Real-time Progress Card */}
      {!isExpanded && (
        <div
          onClick={() => setIsExpanded(true)}
          className="px-3 pb-2.5 pt-1.5 cursor-pointer flex flex-col gap-1.5 text-[11px] text-[#7C756E]"
        >
          {isLive ? (
            <div className="flex items-center gap-2 w-full bg-white/90 px-3 py-2 rounded-xl border border-[#C58B51]/40 shadow-2xs">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C58B51] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#C58B51]"></span>
              </span>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="font-mono text-[10px] font-bold text-[#C58B51] shrink-0">
                  Step {currentStepIndex}/{totalSteps}:
                </span>
                <span className="font-semibold text-[#2C2825] truncate">{activeStepTitle}</span>
              </div>
              <span className="ml-auto text-[10px] text-[#A09890] shrink-0 flex items-center gap-1">
                <span>View pipeline</span>
                <ArrowRight size={10} />
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 w-full text-[10px] text-[#7C756E] pt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C58B51]" />
              <span>Full multi-step reasoning path completed successfully. Click to inspect milestones.</span>
            </div>
          )}
        </div>
      )}

      {/* Expanded Claude-Style Reasoning Path Timeline */}
      {isExpanded && (
        <div className="border-t border-[#E6DFD3]/80 bg-white/90 p-3.5 space-y-4 animate-in fade-in duration-200">
          {/* Sub-header / view switch */}
          <div className="flex items-center justify-between pb-1 text-[11px]">
            <span className="font-bold text-[#2C2825] flex items-center gap-1.5">
              <Sparkles size={12} className="text-[#C58B51]" />
              <span>Reasoning Execution Pipeline</span>
              {isLive && (
                <span className="text-[9px] font-bold uppercase font-mono px-1.5 py-0.2 rounded bg-[#FDF6EE] text-[#B0601B] border border-[#B0601B]/30 flex items-center gap-1">
                  <Loader2 size={9} className="animate-spin" />
                  <span>Real-time Active</span>
                </span>
              )}
            </span>

            {thinkingContent && (
              <div className="flex items-center gap-1.5 bg-[#FAF8F5] p-0.5 rounded-lg border border-[#E6DFD3]">
                <button
                  type="button"
                  onClick={() => setShowRawLogs(false)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                    !showRawLogs
                      ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                      : 'text-[#7C756E] hover:text-[#2C2825]'
                  }`}
                >
                  Visual Pipeline
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawLogs(true)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                    showRawLogs
                      ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                      : 'text-[#7C756E] hover:text-[#2C2825]'
                  }`}
                >
                  Raw Trace
                </button>
              </div>
            )}
          </div>

          {!showRawLogs ? (
            /* Visual Path Timeline */
            <div className="relative pl-6 space-y-3.5 max-h-[50vh] overflow-y-auto pr-2">
              {/* Vertical connecting timeline line */}
              <div className="absolute left-[11px] top-2 bottom-3 w-[1.5px] bg-[#E6DFD3]" />

              {steps.map((step, idx) => {
                const isStepCompleted = step.status === 'completed';
                const isStepActive = step.status === 'active';

                return (
                  <div key={step.id || idx} className="relative flex items-start gap-3">
                    {/* Node on vertical line */}
                    <div
                      className={`absolute -left-6 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border transition-all z-10 ${
                        isStepCompleted
                          ? 'bg-[#FAF8F5] border-[#C58B51] text-[#C58B51] shadow-2xs'
                          : isStepActive
                          ? 'bg-white border-[#C58B51] shadow-xs ring-3 ring-[#C58B51]/30'
                          : 'bg-[#FAF8F5] border-[#E6DFD3] text-[#A09890]'
                      }`}
                    >
                      {getStepIcon(step.category, step.status)}
                    </div>

                    {/* Step Card Content */}
                    <div
                      className={`flex-1 p-3 rounded-xl border transition-all ${
                        isStepActive
                          ? 'bg-[#FAF8F5] border-[#C58B51] shadow-2xs ring-2 ring-[#C58B51]/20'
                          : isStepCompleted
                          ? 'bg-white/90 border-[#E6DFD3]'
                          : 'bg-white/40 border-[#E6DFD3]/60 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          className={`text-xs font-bold leading-tight ${
                            isStepActive
                              ? 'text-[#C58B51]'
                              : isStepCompleted
                              ? 'text-[#2C2825]'
                              : 'text-[#7C756E]'
                          }`}
                        >
                          {step.number}. {step.title}
                        </h4>
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            isStepCompleted
                              ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#C58B51]/30'
                              : isStepActive
                              ? 'bg-[#C58B51] text-white animate-pulse shadow-2xs'
                              : 'bg-transparent text-[#A09890]'
                          }`}
                        >
                          {isStepCompleted ? 'COMPLETED' : isStepActive ? 'IN PROGRESS' : 'QUEUED'}
                        </span>
                      </div>

                      <p className="text-[11px] text-[#7C756E] mt-1 leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Optional Raw Trace Log View */
            <div className="space-y-2">
              <div className="max-h-64 overflow-y-auto pr-1 font-mono text-[11px] leading-relaxed text-[#4A443F] whitespace-pre-wrap select-text bg-[#FAF8F5] p-3 rounded-xl border border-[#E6DFD3]">
                {thinkingContent || 'No raw thinking tokens recorded.'}
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#7C756E]">
                <span>Full token-level internal chain of thought</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[#E6DFD3] hover:text-[#2C2825] hover:border-[#C58B51] transition-all cursor-pointer font-medium"
                >
                  {copied ? (
                    <>
                      <Check size={11} className="text-emerald-600" />
                      <span className="text-emerald-600 font-bold">Copied Trace</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Copy Trace</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Footer toolbar */}
          <div className="pt-2 border-t border-[#E6DFD3]/60 flex items-center justify-between text-[10px] text-[#7C756E]">
            <span className="flex items-center gap-1">
              <Terminal size={11} className="text-[#A09890]" />
              <span>{summary}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] hover:text-[#2C2825] transition-colors cursor-pointer font-medium"
              >
                {copied ? (
                  <>
                    <Check size={10} className="text-emerald-600" />
                    <span className="text-emerald-600 font-bold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={10} />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="px-2 py-0.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] hover:text-[#2C2825] transition-colors cursor-pointer font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
