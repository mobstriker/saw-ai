export type ReasoningMode = 'off' | 'low' | 'medium' | 'high' | 'extra_high';
export type AutomationMode = 'review' | 'automatic' | 'automatic_plus';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokensEstimate?: number;
  /** Input (prompt) tokens for this turn, from the provider's `usage` when
   *  available, else a BPE estimate of the system prompt + conversation sent.
   *  Together with outputTokens this gives the TRUE token spend. */
  inputTokens?: number;
  /** Output (completion) tokens for this turn. Same source as inputTokens; when
   *  the provider reports usage this is exact, else a BPE count of the output. */
  outputTokens?: number;
  webSearchUsed?: boolean;
  searchResults?: SearchResult[];
  mcpToolsUsed?: string[];
  artifacts?: Artifact[];
  thinkingContent?: string;
  isThinking?: boolean;
  reasoningMode?: ReasoningMode;
  thoughtDurationMs?: number;
  clarificationRequest?: { question: string; options: string[]; answered?: boolean; chosenOption?: string };
  clarificationRequests?: { question: string; options: string[]; }[];
  clarificationAnswers?: { question: string; answer: string }[];
  artifactsState?: 'pending' | 'accepted' | 'rejected' | 'auto_applied';
  isError?: boolean;
  isStopped?: boolean;
  modelUsed?: string;
  generationDurationMs?: number;
  /**
   * Snapshot of the bound project's files captured *after* this assistant
   * response's changes were applied by WorkspaceAutopilot. The Restore button
   * (per-response undo) rolls the project files back to this snapshot, keeping
   * everything that existed at this turn and discarding any files created in
   * *later* turns. `projectId` is the project these files belong to (null only
   * for the turn that auto-created the first project from a universal chat).
   * Only present for assistant messages that actually modified a project.
   */
  projectSnapshotBefore?: { projectId: string | null; files: ProjectFile[] };
  /**
   * Timestamp the user clicked Restore on this message. Used to show a
   * "Restored" state on the message and to allow re-restoring.
   */
  restoredAt?: number;
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface Artifact {
  id: string;
  title: string;
  language: string; // 'html' | 'tsx' | 'jsx' | 'svg' | 'javascript' | 'typescript' | 'python' | 'markdown' | 'css' | 'json'
  code: string;
  type: 'code' | 'preview' | 'svg' | 'markdown';
  version?: number;
}

export interface ProjectFile {
  id: string;
  name: string;
  path: string; // e.g. "src/components/Sidebar.tsx"
  content: string;
  size: number;
  lastModified?: number;
  includedInContext: boolean;
  language: string;
}

export interface FolderNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FolderNode[];
  file?: ProjectFile;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions?: string; // Important project instructions/system prompt for AI full context!
  createdAt: number;
  updatedAt: number;
  icon?: string;
  files: ProjectFile[];
  activeFileId?: string;
  systemPromptOverride?: string;
  modelOverride?: string;
  enabledMcpIds?: string[];
}

export interface SkillFile {
  path: string; // e.g. "SKILL.md", "scripts/analyze.py", "templates/output.md"
  name: string;
  content: string;
  language?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  folderName?: string; // e.g. "python-data-analyst"
  triggerConditions?: string; // e.g. "When writing data analysis code or pandas scripts"
  enabledByDefault?: boolean;
  author?: string;
  version?: string;
  files: SkillFile[]; // Must include SKILL.md and optional python/node/etc files
  isBuiltIn?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface SubModelConfig {
  id: string;
  role: 'heavy' | 'medium' | 'flash';
  name: string; // Model label / name
  baseUrl: string;
  apiKey: string;
  model: string; // Model identifier
  customHeaders?: string;
}

export interface AIProfile {
  id: string;
  name: string; // e.g. "Google Gemini Intelligence", "OpenAI GPT-4o", "Claude 3.5 Sonnet (OpenRouter)", "DeepSeek V3", "Local Ollama Llama 3"
  provider: 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders?: string;
  systemPrompt?: string;
  isActive: boolean; // Ticker in settings: "Use this AI"
  maxTokens?: number;
  contextWindow?: number;
  updatedAt?: number;
  mainModelRole?: 'heavy' | 'medium' | 'flash'; // Role of the primary model
  subModels?: SubModelConfig[]; // Up to 2 sub-models (max 3 total models)
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectId?: string; // If bound to a project
  messages: Message[];
  model: string;
  systemPrompt?: string;
  enabledMcpIds?: string[];
  enabledSkillIds?: string[]; // IDs of active skills for this chat
  reasoningMode?: ReasoningMode;
  automationMode?: AutomationMode;
}

export interface BYOKSettings {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  customHeaders?: string;
  systemPrompt: string;
  webSearchEnabled: boolean;
  webSearchMaxResults: number;
  /** Which web-search backend to use. Only ONE provider is active at a time
   *  (whichever is selected here). All three give generous free credits on a
   *  fresh account: 'tavily' (tavily.com), 'serper' (serper.dev — Google
   *  results), and 'langsearch' (langsearch.com — Bing-compatible shape). */
  webSearchProvider?: 'tavily' | 'serper' | 'langsearch';
  /** API key for the Tavily search provider (free key at tavily.com). */
  webSearchApiKey?: string;
  /** API key for the Serper search provider (free key at serper.dev). */
  serperApiKey?: string;
  /** API key for the LangSearch search provider (free key at langsearch.com). */
  langsearchApiKey?: string;
  mcpServers: MCPServer[];
  skills: Skill[]; // Installed and managed skills
  aiProfiles: AIProfile[]; // Saved multiple API keys / AI profiles
  activeProfileId?: string; // Currently active profile selected in settings
  streamResponse: boolean;
  themeAesthetic: 'warm-organic';
  automationMode?: AutomationMode;
  reasoningMode?: ReasoningMode;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** GitHub token with `gist` scope. When set, Flutter previews embed a REAL
   *  DartPad canvas (the AI's Dart is pushed to an anonymous gist and loaded
   *  via dartpad.dev/embed-flutter.html?id=…). Optional — without it we fall
   *  back to the structural widget-tree preview. */
  gistToken?: string;
}

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  type: 'sse' | 'jsonrpc';
  enabled: boolean;
  status: 'online' | 'offline' | 'checking' | 'unknown';
  latencyMs?: number;
  tools: MCPTool[];
}

export interface MCPTool {
  id: string;
  name: string;
  description: string;
  parametersSchema?: string;
  enabled: boolean;
}

export type SidebarTab = 'projects' | 'chats';
export type RightPanelTab = 'files' | 'artifacts';
