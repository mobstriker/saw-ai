import { ChatSession, Project } from '../types';

export interface ChatModelTokenStat {
  model: string;
  /** Total tokens (input + output) spent by this model. */
  tokens: number;
  /** Input (prompt) tokens for this model. */
  inputTokens: number;
  /** Output (completion) tokens for this model. */
  outputTokens: number;
  responses: number;
}

export interface ChatStats {
  /** "Universal Chat" or the bound project's name. */
  scopeLabel: string;
  isUniversal: boolean;
  projectName?: string;
  /** Total tokens spent across all assistant responses in this chat
   *  (input + output). Prefers provider-reported `usage`; falls back to a BPE
   *  estimate of the output only (legacy `tokensEstimate`). */
  totalTokens: number;
  /** Total input (prompt) tokens. */
  totalInputTokens: number;
  /** Total output (completion) tokens. */
  totalOutputTokens: number;
  /** Token spend broken down per model used. */
  perModel: ChatModelTokenStat[];
  /** Distinct file paths created/edited/added by the AI in this chat
   *  (derived from artifacts + project snapshots + bound project files). */
  touchedFiles: string[];
  createdFiles: string[];
  assistantResponses: number;
}

/**
 * Derives per-chat statistics for the sidebar three-dots info popover:
 *  - chat scope (universal vs project)
 *  - total + per-model token spend (sum of message.tokensEstimate)
 *  - files created/edited/added by the AI (from artifacts and the file lists
 *    captured in project snapshots attached to assistant messages)
 *
 * All derived from already-computed data on the chat/project — no extra API
 * calls, no re-tokenization. Cheap enough to run on hover for a single chat.
 */
export function deriveChatStats(chat: ChatSession, projects: Project[]): ChatStats {
  const parentProject = chat.projectId ? projects.find((p) => p.id === chat.projectId) : undefined;

  const perModelMap = new Map<string, ChatModelTokenStat>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let assistantResponses = 0;

  // Collect file paths touched: artifacts + project snapshot file lists + the
  // bound project's current files. We also re-extract code-block filenames
  // from the message content as a last resort, so universal chats (which may
  // never get a projectSnapshotBefore) still report the files the AI produced.
  const touchedSet = new Set<string>();
  const createdSet = new Set<string>();

  for (const m of chat.messages) {
    if (m.role !== 'assistant') continue;
    assistantResponses++;

    // Token accounting: prefer provider usage (inputTokens/outputTokens); fall
    // back to the legacy output-only tokensEstimate so old chats still sum.
    const inTok = m.inputTokens ?? 0;
    const outTok = m.outputTokens ?? m.tokensEstimate ?? 0;
    const turnTotal = inTok + outTok;
    totalInputTokens += inTok;
    totalOutputTokens += outTok;
    totalTokens += turnTotal;

    const model = m.modelUsed || 'Unknown Model';
    const existing = perModelMap.get(model);
    if (existing) {
      existing.inputTokens += inTok;
      existing.outputTokens += outTok;
      existing.tokens += turnTotal;
      existing.responses += 1;
    } else {
      perModelMap.set(model, {
        model,
        tokens: turnTotal,
        inputTokens: inTok,
        outputTokens: outTok,
        responses: 1,
      });
    }

    // Files the AI produced this turn.
    if (m.artifacts && m.artifacts.length > 0) {
      for (const a of m.artifacts) {
        // a.title is the smart filename the markdown renderer derived; fall back
        // to a language-based label only when no title was set.
        const name = a.title || `${a.language || 'code'} Component`;
        touchedSet.add(name);
        createdSet.add(name);
      }
    }
    if (m.projectSnapshotBefore) {
      for (const f of m.projectSnapshotBefore.files) {
        touchedSet.add(f.path);
      }
    }
    // Last resort: scan the content for fenced code blocks with a filename
    // comment (// path/file.ext) or info-string title, mirroring the markdown
    // renderer's smart-filename logic. This catches universal-chat turns where
    // artifacts weren't attached but code was clearly produced.
    if ((!m.artifacts || m.artifacts.length === 0) && m.content) {
      for (const path of extractFilenamesFromContent(m.content)) {
        touchedSet.add(path);
        createdSet.add(path);
      }
    }
  }

  // If the chat is bound to a project, its current file list is the full set
  // of files associated with this chat.
  if (parentProject) {
    for (const f of parentProject.files) {
      touchedSet.add(f.path);
    }
  }

  return {
    scopeLabel: parentProject ? parentProject.name : 'Universal Chat',
    isUniversal: !parentProject,
    projectName: parentProject?.name,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    perModel: Array.from(perModelMap.values()).sort((a, b) => b.tokens - a.tokens),
    touchedFiles: Array.from(touchedSet).sort(),
    createdFiles: Array.from(createdSet).sort(),
    assistantResponses,
  };
}

/** Pull filenames out of fenced code blocks in raw markdown. Matches the smart
 *  filename heuristic: a `// path/file.ext` comment on the first line, the
 *  info-string title, or falls back to `${lang} Component`. */
function extractFilenamesFromContent(content: string): string[] {
  const names: string[] = [];
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content)) !== null) {
    const info = (m[1] || '').trim();
    const body = m[2] || '';
    // Skip shell languages (they aren't files).
    const SHELL = /^(bash|sh|shell|zsh|fish|powershell|pwsh|cmd|doskey|bat|batch|console|terminal)$/i;
    if (SHELL.test(info)) continue;
    const firstLine = body.split('\n')[0] || '';
    const pathComment = firstLine.match(/(?:\/\/|#|<!--)\s*([^\s]+\/[^\s]+)/);
    if (pathComment) {
      names.push(pathComment[1]);
      continue;
    }
    // Info string with a slash looks like a path/title.
    if (info.includes('/')) {
      names.push(info);
      continue;
    }
    const lang = info.split(' ')[0] || 'code';
    if (lang && !SHELL.test(lang)) {
      names.push(`${lang} Component`);
    }
  }
  return names;
}
