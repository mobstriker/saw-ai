export type ReasoningMode = 'off' | 'low' | 'medium' | 'high' | 'extra_high';
export type AutomationMode = 'review' | 'automatic' | 'automatic_plus';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokensEstimate?: number;
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
  provider: 'gemini' | 'openai' | 'openrouter' | 'anthropic' | 'deepseek' | 'groq' | 'ollama' | 'moonshot' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders?: string;
  systemPrompt?: string;
  isActive: boolean; // Ticker in settings: "Use this AI"
  maxTokens?: number;
  contextWindow?: number;
  updatedAt?: number;
  isBundle?: boolean; // Flag if this is a smart model bundle
  modelSmall?: string; // e.g. gemini-2.5-flash or gpt-4o-mini
  modelMedium?: string; // e.g. gemini-2.5-pro or gpt-4o
  modelLarge?: string; // e.g. gemini-2.5-pro or moonshot-v1-auto
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
