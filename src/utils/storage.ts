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

  saveSettings(settings: BYOKSettings): void {
    try {
      db.settings.put({ ...settings, id: 'default' } as any).catch(e => console.error(e));
    } catch (e) {
      console.error('Failed to save settings to DB', e);
    }
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
    try {
      // Clear + bulkPut so deleted projects are actually removed from
      // IndexedDB. bulkPut alone only upserts — it never deletes records
      // that are no longer in the array, so deleted items would reappear
      // on restart.
      db.projects.clear().then(() => db.projects.bulkPut(projects)).catch(e => console.error(e));
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
    try {
      // Clear + bulkPut so deleted chats are actually removed from
      // IndexedDB. bulkPut alone only upserts — it never deletes records
      // that are no longer in the array, so deleted chats would reappear
      // on restart.
      db.chats.clear().then(() => { if (chats.length > 0) return db.chats.bulkPut(chats); }).catch(e => console.error(e));
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
