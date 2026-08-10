import React, { useState } from 'react';
import {
  FileCode,
  Check,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Zap,
  CheckCircle2,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { PatchChunk, PatchApplicationResult, PatchApplier, DiffLine } from '../utils/patchApplier';
import { ProjectFile, Artifact } from '../types';

interface TargetedEditCardProps {
  patch: PatchChunk;
  result?: PatchApplicationResult;
  targetFile?: ProjectFile | null;
  targetArtifact?: Artifact | null;
  isApplied?: boolean;
  onApplyPatch?: (patch: PatchChunk) => void;
  onRevertPatch?: (patch: PatchChunk) => void;
  onOpenFile?: (file: ProjectFile) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
}

export const TargetedEditCard: React.FC<TargetedEditCardProps> = ({
  patch,
  result,
  targetFile,
  targetArtifact,
  isApplied = false,
  onApplyPatch,
  onRevertPatch,
  onOpenFile,
  onOpenArtifact,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [appliedState, setAppliedState] = useState(isApplied);

  const fileName =
    patch.filePath || targetFile?.name || targetArtifact?.title || 'Target File';

  const diffLines: DiffLine[] = React.useMemo(() => {
    return PatchApplier.generateDiffLines(patch.searchChunk, patch.replaceChunk);
  }, [patch.searchChunk, patch.replaceChunk]);

  const searchLineCount = patch.searchChunk.split('\n').length;
  const replaceLineCount = patch.replaceChunk.split('\n').length;
  const percentagePreserved = result?.percentagePreserved ?? 95;

  const handleCopyReplace = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(patch.replaceChunk);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onApplyPatch) {
      onApplyPatch(patch);
      setAppliedState(true);
    }
  };

  const handleRevert = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRevertPatch) {
      onRevertPatch(patch);
      setAppliedState(false);
    }
  };

  return (
    <div className="my-3.5 rounded-2xl border-2 border-[#C58B51]/40 bg-[#FAF8F5] overflow-hidden shadow-xs transition-all hover:border-[#C58B51] font-sans">
      {/* Header Bar */}
      <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white border-b border-[#E6DFD3]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-2xs shrink-0">
            <Zap size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-[#2C2825]">{fileName}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F5E6D3] text-[#C58B51] border border-[#C58B51]/30">
                Claude-Style Targeted Edit
              </span>
              {appliedState ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Auto-Applied
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-300">
                  Ready to Apply
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5 text-[11px] text-[#7C756E] mt-0.5">
              <span className="text-emerald-600 font-bold">+{replaceLineCount} lines</span>
              <span className="text-rose-600 font-bold">-{searchLineCount} lines</span>
              <span className="text-[#A09890]">•</span>
              <span>~{percentagePreserved}% untouched code preserved</span>
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {!appliedState && onApplyPatch && (
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer hover:shadow-xs active:scale-95"
              title="Apply targeted search/replace patch to file"
            >
              <Check size={13} />
              <span>Apply Patch</span>
            </button>
          )}

          {appliedState && onRevertPatch && (
            <button
              type="button"
              onClick={handleRevert}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:border-rose-300 text-rose-600 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              title="Revert this patch from workspace"
            >
              <RotateCcw size={12} />
              <span>Revert</span>
            </button>
          )}

          {targetFile && onOpenFile && (
            <button
              type="button"
              onClick={() => onOpenFile(targetFile)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[#2C2825] text-xs font-medium transition-colors cursor-pointer"
              title="Open full file in Web IDE Editor"
            >
              <FileCode size={13} />
              <span className="hidden sm:inline">View File</span>
            </button>
          )}

          {targetArtifact && onOpenArtifact && (
            <button
              type="button"
              onClick={() => onOpenArtifact(targetArtifact)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[#2C2825] text-xs font-medium transition-colors cursor-pointer"
              title="View live artifact preview"
            >
              <Eye size={13} />
              <span className="hidden sm:inline">View Artifact</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:bg-[#FAF8F5] text-xs font-bold text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
          >
            <span>{isExpanded ? 'Hide Diff' : 'View Diff'}</span>
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Accordion Diff Body */}
      {isExpanded && (
        <div className="p-3.5 space-y-3 bg-[#FAF8F5] animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[11px] text-[#7C756E]">
            <span className="font-semibold">Surgical Code Replacement Chunk:</span>
            <button
              type="button"
              onClick={handleCopyReplace}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-[#E6DFD3] hover:text-[#2C2825] transition-colors cursor-pointer font-medium"
            >
              {copied ? (
                <>
                  <Check size={11} className="text-emerald-600" />
                  <span className="text-emerald-600">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>Copy Replacement</span>
                </>
              )}
            </button>
          </div>

          {/* Unified Diff Table */}
          <div className="rounded-xl border border-[#E6DFD3] bg-white overflow-hidden font-mono text-xs shadow-2xs">
            <div className="p-2 bg-[#F5F1EA] border-b border-[#E6DFD3] flex items-center justify-between text-[10px] text-[#7C756E]">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-rose-600 font-bold">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span> Search (Lines to Replace)
                </span>
                <span className="flex items-center gap-1 text-emerald-600 font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Replace (New Lines)
                </span>
              </div>
              <span>Ground Truth In-Memory IDE</span>
            </div>

            <div className="max-h-72 overflow-auto p-2 divide-y divide-[#E6DFD3]/40">
              {diffLines.map((dl, idx) => (
                <div
                  key={idx}
                  className={`flex items-start py-0.5 px-2 rounded font-mono text-[11px] leading-relaxed ${
                    dl.type === 'delete'
                      ? 'bg-rose-50/80 text-rose-900 line-through decoration-rose-400'
                      : dl.type === 'add'
                      ? 'bg-emerald-50 text-emerald-900 font-semibold'
                      : 'text-[#5C554E]'
                  }`}
                >
                  <span className="w-6 text-[10px] select-none text-[#A09890] shrink-0">
                    {dl.type === 'delete' ? '-' : dl.type === 'add' ? '+' : ' '}
                  </span>
                  <span className="whitespace-pre flex-1 overflow-x-auto">{dl.text || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
