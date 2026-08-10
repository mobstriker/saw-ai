import React, { useState } from 'react';
import {
  Copy,
  Check,
  Eye,
  Code2,
  Sparkles,
  ExternalLink,
  FileCode,
  FolderPlus,
  Zap,
  CheckCircle2,
  Circle,
  ListTodo,
  Flame,
} from 'lucide-react';
import { renderLatexMath } from './mathParser';
import { Artifact, ProjectFile } from '../types';
import { PatchApplier, PatchChunk } from './patchApplier';
import { TargetedEditCard } from '../components/TargetedEditCard';

interface MarkdownRendererProps {
  content: string;
  onOpenArtifact?: (artifact: Artifact) => void;
  onImplementCode?: (code: string, language: string, suggestedPath: string) => void;
  onApplyPatch?: (patch: PatchChunk) => void;
  onRevertPatch?: (patch: PatchChunk) => void;
  targetFile?: ProjectFile | null;
  targetArtifact?: Artifact | null;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onOpenArtifact,
  onImplementCode,
  onApplyPatch,
  onRevertPatch,
  targetFile,
  targetArtifact,
}) => {
  if (!content) return null;

  // Parse out code blocks, targeted search/replace patches, task checklists, and math blocks
  const elements = parseMarkdownBlocks(
    content,
    onOpenArtifact,
    onImplementCode,
    onApplyPatch,
    onRevertPatch,
    targetFile,
    targetArtifact
  );
  return <div className="space-y-3.5 leading-relaxed text-[#2C2825] text-sm">{elements}</div>;
};

interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
}

/**
 * Interactive Task Checklist & Autonomous Execution Plan Card
 */
const TaskChecklistCard: React.FC<{ items: TaskItem[]; title?: string }> = ({
  items: initialItems,
  title,
}) => {
  const [items, setItems] = useState<TaskItem[]>(initialItems);

  // Sync state if props change (e.g. streaming update)
  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const completedCount = items.filter((i) => i.completed).length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isAllComplete = completedCount === totalCount && totalCount > 0;

  const handleToggle = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
    );
  };

  return (
    <div className="my-3 rounded-2xl border border-[#E6DFD3] bg-[#FAF8F5] p-4 shadow-2xs transition-all hover:border-[#C58B51] hover:shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#E6DFD3]/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
            <ListTodo size={16} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-[#2C2825]">
              {title || 'Autonomous Execution Plan'}
            </h4>
            <div className="flex items-center gap-1.5 text-[11px] text-[#7C756E] mt-0.5">
              <span>
                {completedCount} of {totalCount} steps completed ({progressPercent}%)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAllComplete ? (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-700 text-[10px] font-bold">
              <Check size={11} /> All Done
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FAF8F5] border border-[#C58B51] text-[#C58B51] text-[10px] font-bold">
              <Zap size={10} className="fill-[#C58B51]" /> Autonomous Mode
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-[#E6DFD3]/60 h-1.5 rounded-full my-3 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            isAllComplete ? 'bg-emerald-500' : 'bg-[#C58B51]'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Checkbox Items */}
      <div className="space-y-2 pt-1">
        {items.map((item, idx) => (
          <div
            key={item.id || idx}
            onClick={() => handleToggle(item.id)}
            className={`flex items-start gap-3 p-2 rounded-xl transition-all cursor-pointer select-none ${
              item.completed
                ? 'bg-white/80 text-[#7C756E] border border-emerald-100'
                : 'bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[#2C2825]'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {item.completed ? (
                <div className="w-4.5 h-4.5 rounded-md bg-emerald-500 text-white flex items-center justify-center shadow-2xs">
                  <Check size={12} strokeWidth={3} />
                </div>
              ) : (
                <div className="w-4.5 h-4.5 rounded-md border-2 border-[#C58B51] bg-white flex items-center justify-center hover:bg-[#FAF8F5]" />
              )}
            </div>
            <div className="flex-1 text-xs leading-relaxed">
              <span
                className={`${
                  item.completed ? 'line-through text-[#7C756E]' : 'font-medium text-[#2C2825]'
                }`}
              >
                {renderInlineFormatting(item.text)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function parseMarkdownBlocks(
  text: string,
  onOpenArtifact?: (artifact: Artifact) => void,
  onImplementCode?: (code: string, language: string, suggestedPath: string) => void,
  onApplyPatch?: (patch: PatchChunk) => void,
  onRevertPatch?: (patch: PatchChunk) => void,
  targetFile?: ProjectFile | null,
  targetArtifact?: Artifact | null
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for inline / standalone SEARCH/REPLACE block
    if (line.includes('<<<<<<< SEARCH') || line.includes('<<<< SEARCH')) {
      const patchLines: string[] = [line];
      i++;
      while (i < lines.length && !lines[i].includes('>>>>>>> REPLACE') && !lines[i].includes('>>>> REPLACE')) {
        patchLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        patchLines.push(lines[i]);
        i++;
      }

      const fullPatchText = patchLines.join('\n');
      const { patches } = PatchApplier.extractPatches(fullPatchText);
      if (patches.length > 0) {
        patches.forEach((p) => {
          nodes.push(
            <TargetedEditCard
              key={`patch-${blockKey++}`}
              patch={p}
              targetFile={targetFile}
              targetArtifact={targetArtifact}
              onApplyPatch={onApplyPatch}
              onRevertPatch={onRevertPatch}
              onOpenArtifact={onOpenArtifact}
            />
          );
        });
        continue;
      }
    }

    // 1. Math Block: $$ ... $$
    if (line.trim().startsWith('$$')) {
      let mathContent = line.trim().slice(2);
      if (mathContent.endsWith('$$') && mathContent.length > 2) {
        mathContent = mathContent.slice(0, -2);
        nodes.push(
          <div key={`math-${blockKey++}`} className="py-2">
            {renderLatexMath(mathContent, true)}
          </div>
        );
        i++;
        continue;
      } else {
        const mathLines = [mathContent];
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          const last = lines[i].trim().replace(/\$\$$/, '');
          if (last) mathLines.push(last);
          i++;
        }
        nodes.push(
          <div key={`math-block-${blockKey++}`} className="py-2 bg-[#FAF8F5] border border-[#E6DFD3] rounded-xl px-4 my-2">
            {renderLatexMath(mathLines.join('\n'), true)}
          </div>
        );
        continue;
      }
    }

    // 2. Code Block: ```lang
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const fullCode = codeLines.join('\n');

      // Check if code block contains search/replace patch
      if (fullCode.includes('<<<<<<< SEARCH') || fullCode.includes('<<<< SEARCH') || fullCode.includes('[SEARCH]')) {
        const { patches } = PatchApplier.extractPatches(fullCode);
        if (patches.length > 0) {
          patches.forEach((p) => {
            nodes.push(
              <TargetedEditCard
                key={`code-patch-${blockKey++}`}
                patch={p}
                targetFile={targetFile}
                targetArtifact={targetArtifact}
                onApplyPatch={onApplyPatch}
                onRevertPatch={onRevertPatch}
                onOpenArtifact={onOpenArtifact}
              />
            );
          });
          continue;
        }
      }

      // Check if it's an artifact
      let title = '';
      let hasExplicitFilename = false;
      const firstLine = codeLines[0]?.trim() || '';
      const matchTitle =
        firstLine.match(/^\/\/\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i) ||
        firstLine.match(/^<!--\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)\s*-->/i) ||
        firstLine.match(/^#\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i);

      if (matchTitle && matchTitle[1]) {
        title = matchTitle[1].trim();
        hasExplicitFilename = true;
      } else {
        const looseMatch =
          firstLine.match(/^\/\/\s*([a-zA-Z0-9_.\-/]+)/i) ||
          firstLine.match(/^<!--\s*([a-zA-Z0-9_.\-/]+)\s*-->/i) ||
          firstLine.match(/^#\s*([a-zA-Z0-9_.\-/]+)/i);
        if (looseMatch && looseMatch[1] && looseMatch[1].length > 2) {
          title = looseMatch[1].trim();
        } else {
          title = `${lang.toUpperCase()} Component`;
        }
      }

      const isFlutter =
        lang.toLowerCase() === 'dart' ||
        lang.toLowerCase() === 'flutter' ||
        title.endsWith('.dart') ||
        fullCode.includes('package:flutter') ||
        fullCode.includes('StatelessWidget') ||
        fullCode.includes('StatefulWidget') ||
        fullCode.includes('MaterialApp');

      const isPreviewableWeb =
        ['html', 'htm', 'svg', 'tsx', 'jsx'].includes(lang.toLowerCase()) ||
        title.endsWith('.html') ||
        title.endsWith('.htm') ||
        title.endsWith('.svg') ||
        title.endsWith('.tsx') ||
        title.endsWith('.jsx');

      const hasPreview = isFlutter || isPreviewableWeb;

      // An artifact is any block with an explicit filename, or an interactive file/component with > 4 lines, or any code with > 8 lines
      const isArtifact = hasExplicitFilename || (hasPreview && codeLines.length > 4) || codeLines.length > 8;

      const artifactObj: Artifact = {
        id: `art-view-${blockKey}`,
        title: title.includes('.') ? title : `${title}.${lang === 'tsx' ? 'tsx' : lang}`,
        language: lang,
        code: fullCode,
        type: hasPreview ? (lang.toLowerCase() === 'svg' ? 'svg' : 'preview') : 'code',
      };

      nodes.push(
        <CodeBlockWithArtifactChip
          key={`code-${blockKey++}`}
          code={fullCode}
          language={lang}
          title={title}
          isArtifact={isArtifact}
          isInteractive={hasPreview}
          artifact={artifactObj}
          onOpenArtifact={onOpenArtifact}
          onImplementCode={onImplementCode}
        />
      );
      continue;
    }

    // 3. Task Checklists (- [ ] or - [x] or * [ ] or 1. [ ])
    const isTaskItem =
      /^(?:[-*]|\d+\.)\s*\[([ xX])\]\s+(.*)/.test(line.trim());

    if (isTaskItem) {
      const taskList: TaskItem[] = [];
      let planTitle = 'Autonomous Execution Plan';

      // Check if preceding line was a plan header
      const prevNode = nodes[nodes.length - 1];

      while (
        i < lines.length &&
        /^(?:[-*]|\d+\.)\s*\[([ xX])\]\s+(.*)/.test(lines[i].trim())
      ) {
        const m = lines[i].trim().match(/^(?:[-*]|\d+\.)\s*\[([ xX])\]\s+(.*)/);
        if (m) {
          taskList.push({
            id: `task-${blockKey}-${taskList.length}`,
            completed: m[1].toLowerCase() === 'x',
            text: m[2].trim(),
          });
        }
        i++;
      }

      if (taskList.length > 0) {
        nodes.push(
          <TaskChecklistCard
            key={`task-card-${blockKey++}`}
            items={taskList}
            title={planTitle}
          />
        );
        continue;
      }
    }

    // 4. Headers
    if (line.startsWith('#### ')) {
      nodes.push(
        <h4 key={`h4-${blockKey++}`} className="text-xs font-bold uppercase tracking-wider text-[#7C756E] mt-3">
          {renderInlineFormatting(line.slice(5))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${blockKey++}`} className="text-sm font-bold text-[#2C2825] mt-4 mb-1 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#C58B51]"></span>
          {renderInlineFormatting(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={`h2-${blockKey++}`} className="text-base font-bold text-[#2C2825] mt-5 mb-1.5 border-b border-[#E6DFD3] pb-1">
          {renderInlineFormatting(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      nodes.push(
        <h1 key={`h1-${blockKey++}`} className="text-lg font-extrabold text-[#2C2825] mt-5 mb-2">
          {renderInlineFormatting(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    // 5. Blockquotes
    if (line.startsWith('> ')) {
      nodes.push(
        <blockquote
          key={`quote-${blockKey++}`}
          className="border-l-4 border-[#C58B51] pl-3 py-1 my-2 bg-[#FAF8F5] rounded-r-lg text-xs italic text-[#7C756E]"
        >
          {renderInlineFormatting(line.slice(2))}
        </blockquote>
      );
      i++;
      continue;
    }

    // 6. Unordered List Items
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const listItems: string[] = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))
      ) {
        listItems.push(lines[i].trim().slice(2));
        i++;
      }
      nodes.push(
        <ul key={`ul-${blockKey++}`} className="space-y-1.5 my-2 pl-2">
          {listItems.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-[#4A443F]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4A373] mt-1.5 shrink-0" />
              <span>{renderInlineFormatting(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 7. Numbered Lists
    if (/^\d+\.\s/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i++;
      }
      nodes.push(
        <ol key={`ol-${blockKey++}`} className="space-y-1.5 my-2 pl-1">
          {listItems.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-xs text-[#4A443F]">
              <span className="w-4 h-4 rounded-full bg-[#F5F1EA] text-[#C58B51] font-bold text-[10px] flex items-center justify-center shrink-0 border border-[#E6DFD3]">
                {idx + 1}
              </span>
              <span className="flex-1">{renderInlineFormatting(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // Standard Paragraph
    nodes.push(
      <p key={`p-${blockKey++}`} className="text-xs leading-relaxed text-[#4A443F]">
        {renderInlineFormatting(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

/**
 * Renders inline formatting like bold, code, inline math $...$, links, and italic
 */
function renderInlineFormatting(text: string): React.ReactNode {
  // Check for inline math: $formula$
  const parts: React.ReactNode[] = [];
  let keyIndex = 0;

  const mathRegex = /\$([^\$\n]+)\$/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = mathRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(
        <span key={`sub-${keyIndex++}`}>
          {formatBasicInline(text.substring(lastIdx, match.index))}
        </span>
      );
    }
    parts.push(
      <span key={`math-${keyIndex++}`} className="inline-block px-1">
        {renderLatexMath(match[1], false)}
      </span>
    );
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(
      <span key={`sub-end-${keyIndex++}`}>
        {formatBasicInline(text.substring(lastIdx))}
      </span>
    );
  }

  return parts.length > 0 ? parts : formatBasicInline(text);
}

function formatBasicInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3] rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-bold text-[#2C2825]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={index} className="italic text-[#7C756E]">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

/**
 * Code Block Component with Copy, Syntax Display, and Inline Claude "View Artifact" and "Implement" Chips
 */
interface CodeBlockProps {
  code: string;
  language: string;
  title: string;
  isArtifact: boolean;
  isInteractive: boolean;
  artifact: Artifact;
  onOpenArtifact?: (artifact: Artifact) => void;
  onImplementCode?: (code: string, language: string, suggestedPath: string) => void;
}

const CodeBlockWithArtifactChip: React.FC<CodeBlockProps> = ({
  code,
  language,
  title,
  isArtifact,
  isInteractive,
  artifact,
  onOpenArtifact,
  onImplementCode,
}) => {
  const [copied, setCopied] = useState(false);
  const [showInlineCode, setShowInlineCode] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineCount = code.split('\n').length;
  const fileName = title.includes('.') ? title : `${title}.${language === 'tsx' ? 'tsx' : language}`;

  // Extract suggested path
  const firstLine = code.split('\n')[0]?.trim() || '';
  let suggestedPath = fileName;
  const pathMatch =
    firstLine.match(/^\/\/\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i) ||
    firstLine.match(/^<!--\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)\s*-->/i) ||
    firstLine.match(/^#\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i);

  if (pathMatch && pathMatch[1]) {
    suggestedPath = pathMatch[1].trim();
  } else if (!suggestedPath.includes('/')) {
    if (['tsx', 'jsx'].includes(language)) suggestedPath = `src/components/${fileName}`;
    else if (['ts', 'js'].includes(language)) suggestedPath = `src/${fileName}`;
    else if (language === 'dart' || language === 'flutter') suggestedPath = `lib/${fileName}`;
    else if (language === 'python' || language === 'py') suggestedPath = `lib/${fileName}`;
    else if (language === 'env') suggestedPath = `.env`;
    else if (language === 'svg') suggestedPath = `assets/${fileName}`;
    else suggestedPath = `src/${fileName}`;
  }

  // If it's a file artifact, show the compact Artifact Card without dumping full file into chat
  if (isArtifact) {
    const isFlutter =
      language.toLowerCase() === 'dart' ||
      language.toLowerCase() === 'flutter' ||
      fileName.endsWith('.dart') ||
      code.includes('package:flutter') ||
      code.includes('StatelessWidget') ||
      code.includes('StatefulWidget') ||
      code.includes('MaterialApp');

    const isPreviewableWeb =
      ['html', 'htm', 'svg', 'tsx', 'jsx'].includes(language.toLowerCase()) ||
      fileName.endsWith('.html') ||
      fileName.endsWith('.htm') ||
      fileName.endsWith('.svg') ||
      fileName.endsWith('.tsx') ||
      fileName.endsWith('.jsx');

    const hasPreview = isFlutter || isPreviewableWeb;

    return (
      <div className="my-3 space-y-2">
        {/* Compact Claude/Studio-Style Artifact Card */}
        <div className="flex items-center justify-between p-3.5 rounded-2xl border border-[#E6DFD3] bg-[#FAF8F5] transition-all hover:border-[#C58B51] hover:shadow-xs group">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs group-hover:scale-105 transition-transform">
              {isFlutter ? <Flame size={19} className="text-[#C58B51]" /> : hasPreview ? <Sparkles size={19} /> : <FileCode size={19} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#2C2825]">{fileName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white text-[#7C756E] border border-[#E6DFD3] font-mono">
                  {lineCount} lines
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#F5E6D3] text-[#C58B51] font-bold font-mono uppercase">
                  {isFlutter ? 'FLUTTER' : language}
                </span>
              </div>
              <div className="text-[11px] text-[#7C756E] mt-0.5">
                {isFlutter
                  ? 'Flutter app • Phone simulator available in Artifacts'
                  : isPreviewableWeb
                  ? 'Web component • Live preview available in Artifacts'
                  : 'Code artifact • Ready to inspect in Artifacts'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Implement Directly to Project Workspace */}
            {onImplementCode && (
              <button
                type="button"
                onClick={() => onImplementCode(code, language, suggestedPath)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FAF8F5] border border-[#C58B51] hover:bg-[#C58B51] text-[#C58B51] hover:text-white text-xs font-bold shadow-2xs transition-all cursor-pointer hover:shadow-xs active:scale-95"
                title={`Implement into project workspace at ${suggestedPath}`}
              >
                <FolderPlus size={14} />
                <span>Implement</span>
              </button>
            )}

            {/* View Artifact in Right Panel */}
            {onOpenArtifact && (
              <button
                type="button"
                onClick={() => onOpenArtifact(artifact)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-xs font-bold text-white shadow-xs transition-all cursor-pointer hover:shadow-sm active:scale-95"
                title={hasPreview ? 'Open Preview & Code in Right Panel' : 'Open Code in Right Panel'}
              >
                {hasPreview ? <Eye size={14} /> : <Code2 size={14} />}
                <span>{hasPreview ? 'View Artifact' : 'View Code'}</span>
              </button>
            )}

            {/* Quick Copy */}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs font-semibold text-[#7C756E] hover:text-[#2C2825] px-2.5 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] transition-colors cursor-pointer"
              title="Copy code to clipboard"
            >
              {copied ? (
                <>
                  <Check size={13} className="text-emerald-600" />
                  <span className="text-emerald-600 text-[11px]">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span className="text-[11px]">Copy</span>
                </>
              )}
            </button>

            {/* Subtle Inline Code Toggle */}
            <button
              type="button"
              onClick={() => setShowInlineCode(!showInlineCode)}
              className="text-[11px] text-[#A09890] hover:text-[#2C2825] px-1.5 py-1 rounded hover:bg-[#F5F1EA] transition-colors cursor-pointer"
              title={showInlineCode ? 'Hide inline code' : 'Expand raw code in chat'}
            >
              {showInlineCode ? '▲ Hide' : '▼ Code'}
            </button>
          </div>
        </div>

        {/* Optional Collapsed Code Inspector */}
        {showInlineCode && (
          <div className="rounded-xl border border-[#E6DFD3] bg-white overflow-hidden shadow-xs animate-in fade-in duration-150">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#FAF8F5] border-b border-[#E6DFD3] text-[11px]">
              <span className="font-mono font-bold text-[#2C2825]">{fileName}</span>
              <span className="text-[10px] text-[#A09890]">Raw source preview</span>
            </div>
            <div className="p-3 overflow-x-auto max-h-80 text-xs font-mono bg-white text-[#2C2825] leading-relaxed">
              <pre className="m-0">
                <code>{code}</code>
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Generic Plain Code Snippet (short snippets, commands, curl, etc.)
  return (
    <div className="my-3 rounded-xl border border-[#E6DFD3] bg-white overflow-hidden shadow-2xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#FAF8F5] border-b border-[#E6DFD3] text-[11px]">
        <div className="flex items-center gap-2 text-[#7C756E] font-mono">
          <Code2 size={13} className="text-[#C58B51]" />
          <span className="font-bold text-[#2C2825]">{language.toUpperCase()}</span>
          {suggestedPath && <span className="text-[10px] text-[#A09890]">({suggestedPath})</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {onImplementCode && (
            <button
              type="button"
              onClick={() => onImplementCode(code, language, suggestedPath)}
              className="flex items-center gap-1 text-[11px] font-bold text-[#C58B51] hover:text-white hover:bg-[#C58B51] px-2 py-0.5 rounded border border-[#C58B51] transition-all cursor-pointer"
              title={`Implement into project workspace at ${suggestedPath}`}
            >
              <FolderPlus size={12} />
              <span>Implement</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] font-semibold text-[#7C756E] hover:text-[#2C2825] px-2 py-0.5 rounded bg-white border border-[#E6DFD3] hover:border-[#C58B51] transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-600" />
                <span className="text-emerald-600">Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span className="text-[11px]">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div className="p-3 overflow-x-auto max-h-80 text-xs font-mono bg-white text-[#2C2825] leading-relaxed">
        <pre className="m-0">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
};
