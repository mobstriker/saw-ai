import { BYOKSettings, ChatSession, Project, MCPServer } from '../types';
import { SAMPLE_PROJECTS } from '../data/sampleProjects';
import { DEFAULT_SKILLS } from '../data/defaultSkills';
import { DEFAULT_AI_PROFILES } from '../data/defaultProfiles';
import { db } from './db';

const STORAGE_KEYS = {
  SETTINGS: 'byok_ai_settings_v1',
  PROJECTS: 'byok_ai_projects_v1',
  CHATS: 'byok_ai_chats_v1',
  ACTIVE_PROJECT: 'byok_ai_active_project_v1',
  ACTIVE_CHAT: 'byok_ai_active_chat_v1',
};

export const DEFAULT_MCP_SERVERS: MCPServer[] = [];

export const DEFAULT_SETTINGS: BYOKSettings = {
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
  customHeaders: '',
  systemPrompt:
    'You are a high-speed, senior AI programming assistant and context engineer working inside SAW AI. All project files provided in the prompt are raw, unchunked ground-truth code. When writing interactive frontend components, provide clean, complete, modern React/Tailwind/HTML code blocks so the Claude-style Artifacts sandbox can render them immediately. If you need clarification from the user before making large changes, output exactly this JSON block and nothing else (do not use for simple greetings): ```json\n{"clarification_requests": [{"question": "...", "options": ["Option 1", "Option 2"]}]}\n```',
  webSearchEnabled: true,
  webSearchMaxResults: 4,
  webSearchProvider: 'duckduckgo_wikipedia',
  webSearchApiKey: '',
  mcpServers: DEFAULT_MCP_SERVERS,
  skills: DEFAULT_SKILLS,
  aiProfiles: DEFAULT_AI_PROFILES,
  activeProfileId: '',
  streamResponse: true,
  themeAesthetic: 'warm-organic',
  reasoningMode: 'medium',
  automationMode: 'automatic',
};

export const StorageService = {
  async getSettingsAsync(): Promise<BYOKSettings> {
    try {
      const parsed = await db.settings.get('default');
      if (parsed) {
        const profiles = parsed.aiProfiles && Array.isArray(parsed.aiProfiles) && parsed.aiProfiles.length > 0
          ? parsed.aiProfiles
          : DEFAULT_AI_PROFILES;

        let activeId = parsed.activeProfileId || DEFAULT_SETTINGS.activeProfileId;
        if (!profiles.some((p: any) => p.id === activeId)) {
          activeId = profiles[0]?.id || DEFAULT_SETTINGS.activeProfileId;
        }

        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          activeProfileId: activeId,
          skills: parsed.skills && Array.isArray(parsed.skills) && parsed.skills.length > 0 ? parsed.skills : DEFAULT_SKILLS,
          aiProfiles: profiles,
        };
      }
    } catch (e) {
      console.warn('Failed to parse settings from DB', e);
    }
    return DEFAULT_SETTINGS;
  },

  _saveSettingsInFlight: null as Promise<any> | null,

  saveSettings(settings: BYOKSettings): void {
    try {
      // Track the in-flight write so flushPendingAsync() can await it — on
      // desktop the webview is destroyed on window close, which could kill a
      // just-issued put (the "API key gone after closing the app" bug).
      this._saveSettingsInFlight = Promise.resolve(
        db.settings.put({ ...settings, id: 'default' } as any)
      )
        .catch((e) => console.error(e))
        .finally(() => {
          this._saveSettingsInFlight = null;
        });
    } catch (e) {
      console.error('Failed to save settings to DB', e);
    }
  },

  // Debounced persistence: during a streaming response the in-flight chat
  // changes on every token — none of those intermediate states need to hit
  // disk. Only the settled state does. These debounce the writer so we
  // coalesce a burst of changes into a single write.
  //
  // We also stash the latest pending value so `flushPending()` can commit it
  // immediately (e.g. on tab close) instead of just cancelling the timer —
  // cancelling without persisting was losing the last in-flight change.
  _saveChatsTimer: null as ReturnType<typeof setTimeout> | null,
  _saveProjectsTimer: null as ReturnType<typeof setTimeout> | null,
  _pendingChats: null as ChatSession[] | null,
  _pendingProjects: null as Project[] | null,
  _lastChatsSignature: '' as string,
  _lastProjectsSignature: '' as string,

  saveChatsDebounced(chats: ChatSession[], delay = 600): void {
    // Skip writing when nothing actually changed.
    const sig = chats.map((c) => `${c.id}:${c.updatedAt ?? 0}`).join('|');
    if (sig === this._lastChatsSignature) return;
    this._lastChatsSignature = sig;
    this._pendingChats = chats;
    if (this._saveChatsTimer) clearTimeout(this._saveChatsTimer);
    this._saveChatsTimer = setTimeout(() => {
      this._saveChatsTimer = null;
      const pending = this._pendingChats;
      this._pendingChats = null;
      if (pending) this._saveChatsNow(pending);
    }, delay);
  },

  saveProjectsDebounced(projects: Project[], delay = 600): void {
    const sig = projects.map((p) => `${p.id}:${p.updatedAt ?? 0}`).join('|');
    if (sig === this._lastProjectsSignature) return;
    this._lastProjectsSignature = sig;
    this._pendingProjects = projects;
    if (this._saveProjectsTimer) clearTimeout(this._saveProjectsTimer);
    this._saveProjectsTimer = setTimeout(() => {
      this._saveProjectsTimer = null;
      const pending = this._pendingProjects;
      this._pendingProjects = null;
      if (pending) this._saveProjectsNow(pending);
    }, delay);
  },

  // Force-commit any pending debounced writes immediately (e.g. on tab close,
  // reload, or after a stream completes) so the last in-flight change is not
  // lost. Previously this only cleared the timer, which silently DROPPED the
  // pending write — the root cause of chats "not saving" on reload.
  flushPending(): void {
    if (this._saveChatsTimer) {
      clearTimeout(this._saveChatsTimer);
      this._saveChatsTimer = null;
    }
    if (this._saveProjectsTimer) {
      clearTimeout(this._saveProjectsTimer);
      this._saveProjectsTimer = null;
    }
    if (this._pendingChats) {
      const pending = this._pendingChats;
      this._pendingChats = null;
      void this._saveChatsNow(pending);
    }
    if (this._pendingProjects) {
      const pending = this._pendingProjects;
      this._pendingProjects = null;
      void this._saveProjectsNow(pending);
    }
  },

  // Awaitable variant of flushPending(). Used on the Tauri window's
  // close-requested event, where we preventDefault the close, await the
  // writes, then destroy the window — the desktop webview is killed instantly
  // on close, so fire-and-forget writes from pagehide/beforeunload (which
  // don't reliably fire there anyway) never land.
  async flushPendingAsync(): Promise<void> {
    if (this._saveChatsTimer) {
      clearTimeout(this._saveChatsTimer);
      this._saveChatsTimer = null;
    }
    if (this._saveProjectsTimer) {
      clearTimeout(this._saveProjectsTimer);
      this._saveProjectsTimer = null;
    }
    const pendingChats = this._pendingChats;
    const pendingProjects = this._pendingProjects;
    this._pendingChats = null;
    this._pendingProjects = null;
    const ops: Promise<any>[] = [];
    if (pendingChats) ops.push(this._saveChatsNow(pendingChats));
    if (pendingProjects) ops.push(this._saveProjectsNow(pendingProjects));
    if (this._saveSettingsInFlight) ops.push(this._saveSettingsInFlight);
    if (ops.length > 0) await Promise.all(ops);
  },

  async getProjectsAsync(): Promise<Project[]> {
    try {
      const data = await db.projects.toArray();
      if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.warn('Failed to parse projects from DB', e);
    }
    return [];
  },

  saveProjects(projects: Project[]): void {
    // An immediate save SUPERSEDES any pending debounced write: cancel the
    // timer and drop the stale pending list so a later flushPending() can
    // never re-write an older array over this one (which resurrected deleted
    // projects). Also update the signature so the trailing debounced effect
    // call for this same list is correctly skipped.
    this._lastProjectsSignature = projects.map((p) => `${p.id}:${p.updatedAt ?? 0}`).join('|');
    this._pendingProjects = null;
    if (this._saveProjectsTimer) {
      clearTimeout(this._saveProjectsTimer);
      this._saveProjectsTimer = null;
    }
    this._saveProjectsNow(projects);
  },

  // Per-record diff instead of clear()+bulkPut(). Reads the current table,
  // upserts only changed records, deletes removed ones. Turns a full-table
  // rewrite into a minimal write for a typical single-project update.
  async _saveProjectsNow(projects: Project[]): Promise<void> {
    try {
      const existing = await db.projects.toArray();
      const existingIds = new Set(existing.map((p) => p.id));
      const newIds = new Set(projects.map((p) => p.id));

      const toDelete = existing.filter((p) => !newIds.has(p.id)).map((p) => p.id);
      const toUpsert = projects.filter((p) => !existingIds.has(p.id));

      const ops: Promise<any>[] = [];
      if (toDelete.length > 0) ops.push(db.projects.bulkDelete(toDelete));
      if (toUpsert.length > 0) ops.push(db.projects.bulkPut(toUpsert));
      if (ops.length > 0) await Promise.all(ops);
    } catch (e) {
      console.error('Failed to save projects to DB', e);
    }
  },

  async getChatsAsync(): Promise<ChatSession[]> {
    try {
      const data = await db.chats.toArray();
      if (data && data.length > 0) {
        return data.sort((a, b) => b.updatedAt - a.updatedAt);
      }
    } catch (e) {
      console.warn('Failed to parse chats from DB', e);
    }
    return [];
  },

  saveChats(chats: ChatSession[]): void {
    // Same supersede rule as saveProjects: an immediate save cancels and
    // replaces any pending debounced write. Without this, the delete handler's
    // flushPending() re-committed the STALE pre-delete chat list after the
    // deletion, so deleted chats reappeared on the next app launch (especially
    // on desktop, where the window can be destroyed before the trailing
    // debounced write corrects it).
    this._lastChatsSignature = chats.map((c) => `${c.id}:${c.updatedAt ?? 0}`).join('|');
    this._pendingChats = null;
    if (this._saveChatsTimer) {
      clearTimeout(this._saveChatsTimer);
      this._saveChatsTimer = null;
    }
    this._saveChatsNow(chats);
  },

  // Delete removed records + bulkPut (upsert by id) the rest. Avoids the
  // clear()+bulkPut() full-table wipe that previously rewrote every chat on
  // every change. bulkPut upserts by primary key, so existing records are
  // updated in place and new ones inserted; only removed ids are deleted.
  async _saveChatsNow(chats: ChatSession[]): Promise<void> {
    try {
      const existing = await db.chats.toArray();
      const newIds = new Set(chats.map((c) => c.id));

      const toDelete = existing.filter((c) => !newIds.has(c.id)).map((c) => c.id);
      const ops: Promise<any>[] = [];
      if (toDelete.length > 0) ops.push(db.chats.bulkDelete(toDelete));
      if (chats.length > 0) ops.push(db.chats.bulkPut(chats));
      if (ops.length > 0) await Promise.all(ops);
    } catch (e) {
      console.error('Failed to save chats to DB', e);
    }
  },

  // Synchronous fallbacks for initial state
  getSettings(): BYOKSettings {
    return DEFAULT_SETTINGS;
  },
  getProjects(): Project[] {
    return [];
  },
  getChats(): ChatSession[] {
    return [];
  },

  async exportBackupAsync(): Promise<string> {
    const backup = {
      settings: await this.getSettingsAsync(),
      projects: await this.getProjectsAsync(),
      chats: await this.getChatsAsync(),
      exportDate: new Date().toISOString(),
      appVersion: '2.4.0',
    };
    return JSON.stringify(backup, null, 2);
  },

  async importBackupAsync(jsonString: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.settings) await db.settings.put({ ...parsed.settings, id: 'default' });
      if (parsed.projects && Array.isArray(parsed.projects)) await db.projects.bulkPut(parsed.projects);
      if (parsed.chats && Array.isArray(parsed.chats)) await db.chats.bulkPut(parsed.chats);
      return true;
    } catch (e) {
      console.error('Failed to import backup', e);
      return false;
    }
  },
};
