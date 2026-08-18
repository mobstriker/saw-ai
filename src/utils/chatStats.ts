import { ChatSession, Project } from '../types';

export interface ChatModelTokenStat {
  model: string;
  tokens: number;
  responses: number;
}

export interface ChatStats {
  /** "Universal Chat" or the bound project's name. */
  scopeLabel: string;
  isUniversal: boolean;
  projectName?: string;
  /** Total tokens spent across all assistant responses in this chat. */
  totalTokens: number;
  /** Token spend broken down per model used. */
  perModel: ChatModelTokenStat[];
  /** Distinct file paths created/edited/added by the AI in this chat
   *  (derived from artifacts + project snapshots). */
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
  let totalTokens = 0;
  let assistantResponses = 0;

  // Collect file paths touched: artifacts (created/edited code files) +
  // project snapshot file lists (created/added files).
  const touchedSet = new Set<string>();
  const createdSet = new Set<string>();

  // Artifacts present on assistant messages = files the AI produced.
  for (const m of chat.messages) {
    if (m.role !== 'assistant') continue;
    assistantResponses++;
    if (m.tokensEstimate && m.tokensEstimate > 0) {
      totalTokens += m.tokensEstimate;
    }
    const model = m.modelUsed || 'Unknown Model';
    const existing = perModelMap.get(model);
    if (existing) {
      existing.tokens += m.tokensEstimate || 0;
      existing.responses += 1;
    } else {
      perModelMap.set(model, { model, tokens: m.tokensEstimate || 0, responses: 1 });
    }

    if (m.artifacts && m.artifacts.length > 0) {
      for (const a of m.artifacts) {
        if (a.title) {
          touchedSet.add(a.title);
          createdSet.add(a.title);
        }
      }
    }
    // projectSnapshotBefore captures the project's files *after* this turn's
    // changes — every path in it was either created or already present; we
    // treat the snapshot's presence as "this turn touched the project".
    if (m.projectSnapshotBefore) {
      for (const f of m.projectSnapshotBefore.files) {
        touchedSet.add(f.path);
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
    perModel: Array.from(perModelMap.values()).sort((a, b) => b.tokens - a.tokens),
    touchedFiles: Array.from(touchedSet).sort(),
    createdFiles: Array.from(createdSet).sort(),
    assistantResponses,
  };
}
