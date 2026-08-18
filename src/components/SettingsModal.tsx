import React, { useState } from 'react';
import {
  X,
  Key,
  Globe,
  Sliders,
  Server,
  Database,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Sparkles,
  Plus,
  Trash2,
  Copy,
  Radio,
  ExternalLink,
  ShieldCheck,
  Code,
  ChevronDown,
  ChevronRight,
  Flame,
} from 'lucide-react';
import { BYOKSettings, Skill, AIProfile, SubModelConfig } from '../types';
import { MCPTab } from './MCPTab';
import { SkillsTab } from './SkillsTab';
import { AddSkillModal } from './AddSkillModal';
import { StorageService } from '../utils/storage';
import { resolveChatCompletionsUrl, resolveModelForEndpoint, universalFetch } from '../utils/chatProxy';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: BYOKSettings;
  onSaveSettings: (settings: BYOKSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'api' | 'skills' | 'search' | 'mcp' | 'data'>('api');
  const [formData, setFormData] = useState<BYOKSettings>({ ...settings });
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});
  const [pingStatusMap, setPingStatusMap] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [pingMessageMap, setPingMessageMap] = useState<Record<string, string>>({});
  const [detectedInfoMap, setDetectedInfoMap] = useState<Record<string, string | null>>({});
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [openModelsMap, setOpenModelsMap] = useState<Record<string, boolean>>({});

  const isModelOpen = (modelKey: string, defaultOpen = true): boolean => {
    if (openModelsMap[modelKey] !== undefined) {
      return openModelsMap[modelKey];
    }
    return defaultOpen;
  };

  const toggleModelOpen = (modelKey: string, defaultOpen = true) => {
    setOpenModelsMap((prev) => ({
      ...prev,
      [modelKey]: !isModelOpen(modelKey, defaultOpen),
    }));
  };

  const setAllModelsOpen = (profile: AIProfile, open: boolean) => {
    const newMap: Record<string, boolean> = {
      [`primary-${profile.id}`]: open,
    };
    (profile.subModels || []).forEach((sub) => {
      newMap[sub.id] = open;
    });
    setOpenModelsMap((prev) => ({ ...prev, ...newMap }));
  };

  // Skill Modal State
  const [isAddSkillModalOpen, setIsAddSkillModalOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  // Profile Management State
  const [editingProfileId, setEditingProfileId] = useState<string | null>(
    formData.activeProfileId || formData.aiProfiles?.[0]?.id || null
  );

  if (!isOpen) return null;

  const profiles = formData.aiProfiles || [];

  const activeProfile = profiles.find((p) => p.id === formData.activeProfileId) || profiles[0];

  const handleSelectActiveProfile = (profileId: string) => {
    const target = profiles.find((p) => p.id === profileId);
    if (!target) return;

    const updatedProfiles = profiles.map((p) => ({
      ...p,
      isActive: p.id === profileId,
    }));

    setFormData({
      ...formData,
      aiProfiles: updatedProfiles,
      activeProfileId: profileId,
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      defaultModel: target.model,
      customHeaders: target.customHeaders || '',
      systemPrompt: target.systemPrompt || formData.systemPrompt,
    });
    setEditingProfileId(profileId);
  };

  const handleUpdateProfile = (profileId: string, updates: Partial<AIProfile>) => {
    const updatedProfiles = profiles.map((p) => {
      if (p.id !== profileId) return p;
      return { ...p, ...updates, updatedAt: Date.now() };
    });

    const isCurrentActive = profileId === formData.activeProfileId;
    const current = updatedProfiles.find((p) => p.id === profileId);

    setFormData({
      ...formData,
      aiProfiles: updatedProfiles,
      ...(isCurrentActive && current
        ? {
            baseUrl: current.baseUrl,
            apiKey: current.apiKey,
            defaultModel: current.model,
            customHeaders: current.customHeaders || '',
            systemPrompt: current.systemPrompt || formData.systemPrompt,
          }
        : {}),
    });
  };

  const handleAddNewProfile = () => {
    // The only kind of profile this app creates is a custom OpenAI-compatible
    // endpoint. Every field is left blank so the user can plug in ANY provider
    // (OpenAI, OpenRouter, Zhipu, Moonshot, NVIDIA NIM, Token Router, local
    // Ollama/vLLM, ...) with whatever URL, key, and model that provider expects.
    const newProf: AIProfile = {
      id: `profile-${Date.now()}`,
      name: 'Custom Endpoint',
      provider: 'custom',
      baseUrl: '',
      apiKey: '',
      model: '',
      customHeaders: '',
      systemPrompt: formData.systemPrompt,
      isActive: false,
      maxTokens: 0,
      contextWindow: 0,
      updatedAt: Date.now(),
    };

    const updated = [...profiles, newProf];
    setFormData({ ...formData, aiProfiles: updated });
    setEditingProfileId(newProf.id);
  };


  const handleDeleteProfile = (profileId: string) => {
    if (profiles.length === 0) return;
    const filtered = profiles.filter((p) => p.id !== profileId);
    let nextActiveId = formData.activeProfileId;

    if (profileId === formData.activeProfileId) {
      nextActiveId = filtered[0]?.id || '';
      if (filtered[0]) filtered[0].isActive = true;
    }

    const newActive = filtered.find((p) => p.id === nextActiveId) || filtered[0];

    setFormData({
      ...formData,
      aiProfiles: filtered,
      activeProfileId: newActive?.id || '',
      baseUrl: newActive?.baseUrl || '',
      apiKey: newActive?.apiKey || '',
      defaultModel: newActive?.model || '',
      customHeaders: newActive?.customHeaders || '',
      systemPrompt: newActive?.systemPrompt || formData.systemPrompt,
    });
    setEditingProfileId(newActive?.id || null);
  };

  const handleDuplicateProfile = (profile: AIProfile) => {
    const dup: AIProfile = {
      ...profile,
      id: `profile-${Date.now()}`,
      name: `${profile.name} (Copy)`,
      isActive: false,
      updatedAt: Date.now(),
    };
    const updated = [...profiles, dup];
    setFormData({ ...formData, aiProfiles: updated });
    setEditingProfileId(dup.id);
  };

  const handleSave = () => {
    // Ensure active profile synchronization
    const currentActive = profiles.find((p) => p.id === formData.activeProfileId) || profiles[0];
    const finalSettings: BYOKSettings = {
      ...formData,
      baseUrl: currentActive?.baseUrl || '',
      apiKey: currentActive?.apiKey || '',
      defaultModel: currentActive?.model || '',
      customHeaders: currentActive?.customHeaders || '',
      systemPrompt: currentActive?.systemPrompt || formData.systemPrompt,
    };
    onSaveSettings(finalSettings);
    onClose();
  };

  const testProfileConnection = async (id: string, baseUrl: string, apiKey: string, model: string, customHeaders?: string) => {
    const trimmedUrl = (baseUrl || '').trim();
    if (!trimmedUrl) {
      setPingStatusMap((prev) => ({ ...prev, [id]: 'error' }));
      setPingMessageMap((prev) => ({ ...prev, [id]: 'Please enter a valid Base URL.' }));
      return;
    }

    setPingStatusMap((prev) => ({ ...prev, [id]: 'testing' }));
    setPingMessageMap((prev) => ({ ...prev, [id]: 'Testing endpoint connection & latency...' }));
    setDetectedInfoMap((prev) => ({ ...prev, [id]: null }));

    // Detect provider from the URL for status display
    const detectedProvider =
      trimmedUrl.includes('openrouter.ai') ? 'OpenRouter' :
      trimmedUrl.includes('api.openai.com') ? 'OpenAI' :
      trimmedUrl.includes('api.deepseek.com') ? 'DeepSeek' :
      trimmedUrl.includes('api.groq.com') ? 'Groq' :
      trimmedUrl.includes('api.moonshot.cn') ? 'Moonshot' :
      trimmedUrl.includes('generativelanguage.googleapis.com') ? 'Google Gemini' :
      trimmedUrl.includes('open.bigmodel.cn') ? 'Zhipu (Z-AI)' :
      trimmedUrl.includes('integrate.api.nvidia.com') ? 'NVIDIA NIM' :
      trimmedUrl.includes('api.anthropic.com') ? 'Anthropic' :
      trimmedUrl.includes('localhost') || trimmedUrl.includes('127.0.0.1') ? 'Local' : 'Custom';

    // Always probe the real /chat/completions endpoint with a minimal
    // 1-token request. This validates the key + model + endpoint together,
    // the same way the chat path does, and works for any OpenAI-compatible
    // provider.
    const probeUrl = resolveChatCompletionsUrl(trimmedUrl);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'SAW-AI-Workspace/2.4.0',
    };
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    // Apply any user-configured custom headers from the profile so the
    // test connection uses the same headers as the real chat request.
    if (customHeaders && customHeaders.trim()) {
      try {
        const parsed = JSON.parse(customHeaders);
        if (parsed && typeof parsed === 'object') {
          Object.assign(headers, parsed);
        }
      } catch {
        // malformed JSON — skip
      }
    }

    const method = 'POST';
    const body = JSON.stringify({
      // Normalize model id for the endpoint (strip provider/ prefix for direct APIs)
      model: resolveModelForEndpoint(trimmedUrl, (model || '').trim()) || 'gpt-4o',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    });

    const startTime = Date.now();
    try {
      const res = await universalFetch(probeUrl, { method, headers, body, signal: AbortSignal.timeout(8000) });
      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        setPingStatusMap((prev) => ({ ...prev, [id]: 'success' }));
        setPingMessageMap((prev) => ({
          ...prev,
          [id]: `Connection verified! (${latencyMs}ms latency)`,
        }));
        setDetectedInfoMap((prev) => ({
          ...prev,
          [id]: `Provider: ${detectedProvider} • Status: HTTP ${res.status}`,
        }));
      } else {
        // Surface the real provider error so the user knows exactly what's wrong
        // (e.g. "model not found", "invalid api key"). A 401/429 confirms the
        // endpoint is reachable but the key/quota has an issue. A 400 usually
        // means the model name is wrong — show the error, not "verified".
        let errDetail = `Endpoint responded with HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errDetail = errData?.error?.message || errData?.error || errData?.message || errDetail;
        } catch {}
        // 401 = key issue but endpoint reachable; 429 = rate limit but reachable.
        // 400 = bad request (wrong model name) — show the real error.
        const keyReachable = res.status === 401 || res.status === 429;
        setPingStatusMap((prev) => ({ ...prev, [id]: keyReachable ? 'success' : 'error' }));
        setPingMessageMap((prev) => ({
          ...prev,
          [id]: keyReachable
            ? `Endpoint reachable (${latencyMs}ms). Note: ${errDetail}`
            : `Connection failed: ${errDetail}`,
        }));
        setDetectedInfoMap((prev) => ({
          ...prev,
          [id]: `Provider: ${detectedProvider} • Status: HTTP ${res.status}`,
        }));
      }
    } catch (err: any) {
      setPingStatusMap((prev) => ({ ...prev, [id]: 'error' }));
      setPingMessageMap((prev) => ({ ...prev, [id]: `Connection failed: ${err.message || 'Network error'}` }));
    }
  };

  const handleAddSubModel = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    const currentSubModels = profile.subModels || [];
    if (currentSubModels.length >= 2) {
      alert("Maximum of 3 models (1 primary + 2 additional) can be configured within a single profile.");
      return;
    }

    const roles: ('flash' | 'medium' | 'heavy')[] = ['flash', 'heavy', 'medium'];
    const usedRoles = [profile.mainModelRole || 'medium', ...currentSubModels.map(s => s.role)];
    const freeRole = roles.find(r => !usedRoles.includes(r)) || 'flash';

    const newSubId = `sub-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newSub: SubModelConfig = {
      id: newSubId,
      role: freeRole,
      name: `AI Model #${currentSubModels.length + 2}`,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: '',
    };

    const mainModelRole = profile.mainModelRole || 'medium';

    setOpenModelsMap((prev) => ({
      ...prev,
      [newSubId]: true,
    }));

    handleUpdateProfile(profileId, {
      mainModelRole,
      subModels: [...currentSubModels, newSub],
    });
  };

  const handleDeleteSubModel = (profileId: string, subModelId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    const filtered = (profile.subModels || []).filter((s) => s.id !== subModelId);
    handleUpdateProfile(profileId, {
      subModels: filtered,
    });
  };

  const handleUpdateSubModel = (profileId: string, subModelId: string, updates: Partial<SubModelConfig>) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    const updated = (profile.subModels || []).map((s) => {
      if (s.id !== subModelId) return s;
      return { ...s, ...updates };
    });

    handleUpdateProfile(profileId, {
      subModels: updated,
    });
  };

  const handleExportBackup = async () => {
    const jsonStr = await StorageService.exportBackupAsync();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saw-ai-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const ok = await StorageService.importBackupAsync(content);
      if (ok) {
        setImportStatus('Backup restored successfully! Refreshing...');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setImportStatus('Failed to import backup. Please verify JSON schema.');
      }
    };
    reader.readAsText(file);
  };

  const selectedProfileForEdit =
    profiles.find((p) => p.id === editingProfileId) || activeProfile;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4 animate-in fade-in duration-150">
        <div className="flex flex-col w-full max-w-4xl max-h-[92vh] bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans text-[#2C2825]">
          {/* Modal Top Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6DFD3] bg-[#FAF8F5]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-xs">
                <Sliders size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#2C2825]">SAW AI Workspace Settings</h3>
                <p className="text-[11px] text-[#7C756E]">
                  Multiple AI keys & models, Agent Skills, MCP servers, and Web Search
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-[#F5F1EA] text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1.5 px-6 py-2 border-b border-[#E6DFD3] bg-white text-xs overflow-x-auto">
            <button
              onClick={() => setActiveTab('api')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer shrink-0 ${
                activeTab === 'api'
                  ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              <Key size={14} />
              <span>API & Multiple AI Keys</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]">
                {profiles.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('skills')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer shrink-0 ${
                activeTab === 'skills'
                  ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              <Sparkles size={14} />
              <span>Skills (Agent Bundles)</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]">
                {formData.skills?.length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('search')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer shrink-0 ${
                activeTab === 'search'
                  ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              <Globe size={14} />
              <span>Web Search</span>
            </button>

            <button
              onClick={() => setActiveTab('mcp')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer shrink-0 ${
                activeTab === 'mcp'
                  ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              <Server size={14} />
              <span>MCP Protocol</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]">
                {formData.mcpServers?.length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('data')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer shrink-0 ${
                activeTab === 'data'
                  ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              <Database size={14} />
              <span>Backup & Data</span>
            </button>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
            {/* 1. API & MULTIPLE AI KEYS TAB */}
            {activeTab === 'api' && (
              <div className="space-y-6">
                {/* Banner */}
                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Cpu size={16} className="text-[#C58B51]" />
                      <h4 className="text-xs font-bold text-[#2C2825]">Multiple API Keys & AI Provider Profiles</h4>
                    </div>
                    <p className="text-xs text-[#7C756E] leading-relaxed">
                      Save multiple AI models and API keys. Click the ticker <strong className="text-[#2C2825]">“Use this AI”</strong> on any profile and click <strong className="text-[#2C2825]">Save Settings</strong> to activate that AI model for all your conversations.
                    </p>
                  </div>

                  <div className="shrink-0">
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-xl bg-white border border-[#E6DFD3] text-[#C58B51] shadow-2xs">
                      Active: {activeProfile?.name || 'None'}
                    </span>
                  </div>
                </div>

                {/* Profiles Master-Detail Layout */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* Left Column: List of Saved AI Profiles (5 cols) */}
                  <div className="md:col-span-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#2C2825]">Configured AI Profiles</span>
                      <button
                        type="button"
                        onClick={() => handleAddNewProfile()}
                        className="px-2.5 py-1 rounded-lg bg-[#FAF8F5] hover:bg-[#F5F1EA] text-xs font-bold text-[#C58B51] border border-[#E6DFD3] flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Plus size={13} />
                        <span>Add Custom Endpoint</span>
                      </button>
                    </div>

                    {/* Profiles Cards */}
                    <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                      {profiles.length === 0 && (
                        <div className="text-center py-6 px-4 bg-[#FAF8F5] rounded-xl border border-dashed border-[#E6DFD3]">
                          <p className="text-xs font-medium text-[#7C756E] mb-2">No AI endpoints configured.</p>
                          <p className="text-[10px] text-[#A09890]">Click “Add Custom Endpoint” to connect any OpenAI-compatible API.</p>
                        </div>
                      )}
                      {profiles.map((p) => {
                        const isCurrentActive = p.id === formData.activeProfileId;
                        const isEditingThis = p.id === selectedProfileForEdit?.id;

                        return (
                          <div
                            key={p.id}
                            onClick={() => setEditingProfileId(p.id)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer ${
                              isEditingThis
                                ? 'border-[#C58B51] bg-[#FAF8F5] shadow-xs'
                                : 'border-[#E6DFD3] bg-white hover:border-[#D9CFBF]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-bold text-[#2C2825] truncate">
                                  {p.name}
                                </span>
                              </div>

                              {/* The "Use this AI" Ticker / Radio */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectActiveProfile(p.id);
                                }}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                  isCurrentActive
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-[#FAF8F5] text-[#7C756E] hover:text-[#2C2825] border border-[#E6DFD3]'
                                }`}
                                title="Set this AI Profile as active for the workspace"
                              >
                                <Check size={11} className={isCurrentActive ? 'text-emerald-700 font-bold' : 'opacity-0'} />
                                <span>{isCurrentActive ? 'Active AI' : 'Use this AI'}</span>
                              </button>
                            </div>

                            <div className="flex items-center justify-between text-[11px] font-mono text-[#7C756E]">
                              {p.subModels && p.subModels.length > 0 ? (
                                <span className="text-[9px] font-bold text-[#C58B51] bg-[#FAF8F5] border border-[#C58B51]/30 px-1.5 py-0.5 rounded uppercase">
                                  Smart Bundle: {p.subModels.length + 1} Models
                                </span>
                              ) : (
                                <span className="truncate max-w-[150px]">{p.model}</span>
                              )}
                              <span className="text-[10px] text-[#A09890]">
                                {p.apiKey ? 'Key Set' : 'No Key'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Active Profile Editor & Verification (7 cols) */}
                  {selectedProfileForEdit ? (
                  <div className="md:col-span-7 p-5 rounded-2xl border border-[#E6DFD3] bg-[#FAF8F5] space-y-4">
                    <div className="flex items-center justify-between border-b border-[#E6DFD3] pb-3">
                      <div>
                        <h4 className="text-xs font-bold text-[#2C2825]">
                          Editing: {selectedProfileForEdit.name}
                        </h4>
                        <p className="text-[10px] text-[#7C756E]">
                          Configure endpoint URL, credentials, and model parameters
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSelectActiveProfile(selectedProfileForEdit.id)}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs ${
                            selectedProfileForEdit.id === formData.activeProfileId
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white border border-[#E6DFD3] text-[#2C2825] hover:border-[#C58B51]'
                          }`}
                        >
                          <Check size={13} />
                          <span>
                            {selectedProfileForEdit.id === formData.activeProfileId
                              ? 'Active AI (Selected)'
                              : 'Use this AI'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateProfile(selectedProfileForEdit)}
                          className="p-1.5 rounded-lg bg-white border border-[#E6DFD3] text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                          title="Duplicate Profile"
                        >
                          <Copy size={13} />
                        </button>
                        {profiles.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteProfile(selectedProfileForEdit.id)}
                            className="p-1.5 rounded-lg bg-white border border-[#E6DFD3] text-[#7C756E] hover:text-red-600 cursor-pointer"
                            title="Delete Profile"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Profile Name */}
                    <div>
                      <label className="block text-xs font-bold text-[#2C2825] mb-1">
                        Profile Suite Name / Label
                      </label>
                      <input
                        type="text"
                        value={selectedProfileForEdit.name}
                        onChange={(e) =>
                          handleUpdateProfile(selectedProfileForEdit.id, { name: e.target.value })
                        }
                        placeholder="e.g. Multi-Model AI Suite, OpenAI GPT-4o, Claude 3.5"
                        className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
                      />
                    </div>

                    {/* Section: Configured AI Models (Up to 3 Max) */}
                    <div className="space-y-3 pt-1">
                      {(() => {
                        const hasMultipleModels = (selectedProfileForEdit.subModels?.length || 0) > 0;
                        const totalModels = (selectedProfileForEdit.subModels?.length || 0) + 1;

                        return (
                          <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E6DFD3] pb-2">
                              <div>
                                <h5 className="text-xs font-bold text-[#2C2825] flex items-center gap-1.5">
                                  <Sparkles size={14} className="text-[#C58B51]" />
                                  <span>
                                    {hasMultipleModels
                                      ? 'Configured Models (Smart Task Routing)'
                                      : 'Configured AI Model'}
                                  </span>
                                </h5>
                                <p className="text-[10px] text-[#7C756E]">
                                  {hasMultipleModels
                                    ? 'Assign roles (Small / Medium / Large). Each model uses its own independent endpoint & credentials.'
                                    : 'Endpoint credentials and model settings. This model automatically handles all workspace tasks.'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {hasMultipleModels && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setAllModelsOpen(selectedProfileForEdit, false)}
                                      className="text-[10px] font-semibold text-[#7C756E] hover:text-[#2C2825] underline cursor-pointer"
                                    >
                                      Collapse All
                                    </button>
                                    <span className="text-[#D9CFBF] text-[10px]">•</span>
                                    <button
                                      type="button"
                                      onClick={() => setAllModelsOpen(selectedProfileForEdit, true)}
                                      className="text-[10px] font-semibold text-[#7C756E] hover:text-[#2C2825] underline cursor-pointer"
                                    >
                                      Expand All
                                    </button>
                                  </>
                                )}
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#E6DFD3] text-[#C58B51]">
                                  {hasMultipleModels ? `${totalModels}/3` : '1 Model (All Tasks)'}
                                </span>
                              </div>
                            </div>

                            {/* --- MODEL #1 (PRIMARY MODEL) --- */}
                            {(() => {
                              const primaryKey = `primary-${selectedProfileForEdit.id}`;
                              const isOpen = isModelOpen(primaryKey, true);
                              const role = selectedProfileForEdit.mainModelRole || 'medium';

                              return (
                                <div className="rounded-xl bg-white border border-[#E6DFD3] shadow-2xs transition-all overflow-hidden">
                                  {/* Collapsible Header */}
                                  <div
                                    onClick={() => toggleModelOpen(primaryKey, true)}
                                    className="w-full flex items-center justify-between p-3 bg-white hover:bg-[#FAF8F5]/80 cursor-pointer select-none transition-colors"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {isOpen ? (
                                        <ChevronDown size={15} className="text-[#C58B51] shrink-0" />
                                      ) : (
                                        <ChevronRight size={15} className="text-[#7C756E] shrink-0" />
                                      )}
                                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#C58B51] text-[10px] font-bold text-white shrink-0">
                                        1
                                      </span>
                                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span className="text-xs font-bold text-[#2C2825] truncate">
                                          {selectedProfileForEdit.name || (hasMultipleModels ? 'Primary Model' : 'Main AI Model')}
                                        </span>
                                        {selectedProfileForEdit.model && (
                                          <span className="text-[10px] font-mono text-[#7C756E] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#E6DFD3] truncate max-w-[130px]">
                                            {selectedProfileForEdit.model}
                                          </span>
                                        )}
                                        {hasMultipleModels && (
                                          <span
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                                              role === 'flash'
                                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                                : role === 'heavy'
                                                ? 'bg-purple-50 text-purple-800 border-purple-200'
                                                : 'bg-blue-50 text-blue-800 border-blue-200'
                                            }`}
                                          >
                                            {role === 'flash'
                                              ? '⚡ Small / Flash'
                                              : role === 'heavy'
                                              ? '🧠 Large / Heavy'
                                              : '⚖️ Medium'}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0 ml-2">
                                      <span
                                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                          selectedProfileForEdit.apiKey
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                            : 'bg-stone-100 text-stone-500 border border-stone-200'
                                        }`}
                                      >
                                        {selectedProfileForEdit.apiKey ? '✓ Key Set' : 'No Key'}
                                      </span>
                                      <span className="text-[11px] text-[#7C756E] font-medium hidden sm:inline">
                                        {isOpen ? 'Close' : 'Edit'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Expanded Content */}
                                  {isOpen && (
                                    <div className="p-4 pt-3 border-t border-[#E6DFD3] space-y-3.5 bg-white animate-in fade-in duration-100">
                                      {/* Job Tier Selector - ONLY displayed when multiple models exist */}
                                      {hasMultipleModels && (
                                        <div>
                                          <div className="flex items-center justify-between mb-1.5">
                                            <label className="text-[10px] font-bold text-[#2C2825]">
                                              Job Tier & Routing Role
                                            </label>
                                            <span className="text-[10px] text-[#7C756E]">
                                              Select when this model is routed
                                            </span>
                                          </div>
                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleUpdateProfile(selectedProfileForEdit.id, { mainModelRole: 'flash' })
                                              }
                                              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                                role === 'flash'
                                                  ? 'bg-[#FAF8F5] border-[#C58B51] ring-1 ring-[#C58B51]/30 shadow-2xs'
                                                  : 'bg-white border-[#E6DFD3] hover:border-[#D9CFBF] hover:bg-[#FAF8F5]/40'
                                              }`}
                                            >
                                              <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex items-center gap-1.5">
                                                  <span className="text-xs">⚡</span>
                                                  <span className="text-xs font-bold text-[#2C2825]">Small / Flash</span>
                                                </div>
                                                {role === 'flash' && <Check size={12} className="text-[#C58B51]" />}
                                              </div>
                                              <p className="text-[10px] text-[#7C756E] leading-tight">
                                                Quick greetings, small queries & fast checks
                                              </p>
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleUpdateProfile(selectedProfileForEdit.id, { mainModelRole: 'medium' })
                                              }
                                              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                                role === 'medium'
                                                  ? 'bg-[#FAF8F5] border-[#C58B51] ring-1 ring-[#C58B51]/30 shadow-2xs'
                                                  : 'bg-white border-[#E6DFD3] hover:border-[#D9CFBF] hover:bg-[#FAF8F5]/40'
                                              }`}
                                            >
                                              <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex items-center gap-1.5">
                                                  <span className="text-xs">⚖️</span>
                                                  <span className="text-xs font-bold text-[#2C2825]">Medium</span>
                                                </div>
                                                {role === 'medium' && <Check size={12} className="text-[#C58B51]" />}
                                              </div>
                                              <p className="text-[10px] text-[#7C756E] leading-tight">
                                                General coding, chat & standard tasks
                                              </p>
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleUpdateProfile(selectedProfileForEdit.id, { mainModelRole: 'heavy' })
                                              }
                                              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                                role === 'heavy'
                                                  ? 'bg-[#FAF8F5] border-[#C58B51] ring-1 ring-[#C58B51]/30 shadow-2xs'
                                                  : 'bg-white border-[#E6DFD3] hover:border-[#D9CFBF] hover:bg-[#FAF8F5]/40'
                                              }`}
                                            >
                                              <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex items-center gap-1.5">
                                                  <span className="text-xs">🧠</span>
                                                  <span className="text-xs font-bold text-[#2C2825]">Large / Heavy</span>
                                                </div>
                                                {role === 'heavy' && <Check size={12} className="text-[#C58B51]" />}
                                              </div>
                                              <p className="text-[10px] text-[#7C756E] leading-tight">
                                                Complex refactors, deep reasoning & full edits
                                              </p>
                                            </button>
                                          </div>
                                        </div>
                                      )}

                                      {/* Model Name & Model Identifier */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      Model Display Name
                                    </label>
                                    <input
                                      type="text"
                                      value={selectedProfileForEdit.name}
                                      onChange={(e) =>
                                        handleUpdateProfile(selectedProfileForEdit.id, { name: e.target.value })
                                      }
                                      placeholder="e.g. Primary GPT-4o, Kimi K3"
                                      className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      Model Identifier (API Parameter)
                                    </label>
                                    <input
                                      type="text"
                                      value={selectedProfileForEdit.model}
                                      onChange={(e) =>
                                        handleUpdateProfile(selectedProfileForEdit.id, { model: e.target.value })
                                      }
                                      placeholder="gpt-4o, claude-3-5-sonnet, moonshot-v1-auto"
                                      className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                                    />
                                  </div>
                                </div>

                                {/* Base URL & API Key */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      Base URL (OpenAI-Compatible)
                                    </label>
                                    <input
                                      type="text"
                                      value={selectedProfileForEdit.baseUrl}
                                      onChange={(e) =>
                                        handleUpdateProfile(selectedProfileForEdit.id, { baseUrl: e.target.value })
                                      }
                                      placeholder="https://api.openai.com/v1"
                                      className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      API Key / Secret
                                    </label>
                                    <div className="relative">
                                      <input
                                        type={showKeyMap[selectedProfileForEdit.id] ? 'text' : 'password'}
                                        value={selectedProfileForEdit.apiKey}
                                        onChange={(e) =>
                                          handleUpdateProfile(selectedProfileForEdit.id, { apiKey: e.target.value })
                                        }
                                        placeholder="sk-... or API secret"
                                        className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono pr-8"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setShowKeyMap((prev) => ({
                                            ...prev,
                                            [selectedProfileForEdit.id]: !prev[selectedProfileForEdit.id],
                                          }))
                                        }
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                                      >
                                        {showKeyMap[selectedProfileForEdit.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                {/* Custom Headers */}
                                <div>
                                  <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                    Custom Headers (Optional JSON)
                                  </label>
                                  <input
                                    type="text"
                                    value={selectedProfileForEdit.customHeaders || ''}
                                    onChange={(e) =>
                                      handleUpdateProfile(selectedProfileForEdit.id, { customHeaders: e.target.value })
                                    }
                                    placeholder='{"HTTP-Referer": "https://...", "X-Title": "My App"}'
                                    className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                                  />
                                </div>

                                {/* Test Connection Button & Result for Primary Model */}
                                <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-bold text-[#2C2825]">
                                      Verify Primary Model Connection
                                    </div>
                                    {pingMessageMap[selectedProfileForEdit.id] && (
                                      <div
                                        className={`text-[10px] mt-0.5 font-medium flex items-start gap-1.5 ${
                                          pingStatusMap[selectedProfileForEdit.id] === 'success'
                                            ? 'text-emerald-700'
                                            : pingStatusMap[selectedProfileForEdit.id] === 'error'
                                            ? 'text-amber-800'
                                            : 'text-[#7C756E]'
                                        }`}
                                      >
                                        {pingStatusMap[selectedProfileForEdit.id] === 'success' ? (
                                          <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
                                        ) : pingStatusMap[selectedProfileForEdit.id] === 'error' ? (
                                          <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                        ) : (
                                          <RefreshCw size={12} className="shrink-0 animate-spin text-[#C58B51] mt-0.5" />
                                        )}
                                        <div className="truncate">
                                          <span>{pingMessageMap[selectedProfileForEdit.id]}</span>
                                          {detectedInfoMap[selectedProfileForEdit.id] && (
                                            <div className="text-[9px] text-[#7C756E] font-mono">
                                              {detectedInfoMap[selectedProfileForEdit.id]}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      testProfileConnection(
                                        selectedProfileForEdit.id,
                                        selectedProfileForEdit.baseUrl,
                                        selectedProfileForEdit.apiKey,
                                        selectedProfileForEdit.model,
                                        selectedProfileForEdit.customHeaders
                                      )
                                    }
                                    disabled={pingStatusMap[selectedProfileForEdit.id] === 'testing'}
                                    className="px-3 py-1.5 rounded-lg bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-bold text-[#2C2825] shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                                  >
                                    <RefreshCw
                                      size={11}
                                      className={
                                        pingStatusMap[selectedProfileForEdit.id] === 'testing'
                                          ? 'animate-spin text-[#C58B51]'
                                          : ''
                                      }
                                    />
                                    <span>
                                      {pingStatusMap[selectedProfileForEdit.id] === 'testing'
                                        ? 'Testing...'
                                        : 'Test Connection'}
                                    </span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* --- SUB-MODELS (Models #2 and #3) --- */}
                      {(selectedProfileForEdit.subModels || []).map((sub, index) => {
                        const modelNumber = index + 2;
                        const isOpen = isModelOpen(sub.id, true);

                        return (
                          <div
                            key={sub.id}
                            className="rounded-xl bg-white border border-[#E6DFD3] shadow-2xs transition-all overflow-hidden"
                          >
                            {/* Collapsible Header */}
                            <div
                              onClick={() => toggleModelOpen(sub.id, true)}
                              className="w-full flex items-center justify-between p-3 bg-white hover:bg-[#FAF8F5]/80 cursor-pointer select-none transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isOpen ? (
                                  <ChevronDown size={15} className="text-[#C58B51] shrink-0" />
                                ) : (
                                  <ChevronRight size={15} className="text-[#7C756E] shrink-0" />
                                )}
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#7C756E] text-[10px] font-bold text-white shrink-0">
                                  {modelNumber}
                                </span>
                                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                  <span className="text-xs font-bold text-[#2C2825] truncate">
                                    {sub.name || `Model #${modelNumber}`}
                                  </span>
                                  {sub.model && (
                                    <span className="text-[10px] font-mono text-[#7C756E] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#E6DFD3] truncate max-w-[130px]">
                                      {sub.model}
                                    </span>
                                  )}
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                                      sub.role === 'flash'
                                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                                        : sub.role === 'heavy'
                                        ? 'bg-purple-50 text-purple-800 border-purple-200'
                                        : 'bg-blue-50 text-blue-800 border-blue-200'
                                    }`}
                                  >
                                    {sub.role === 'flash'
                                      ? '⚡ Small / Flash'
                                      : sub.role === 'heavy'
                                      ? '🧠 Large / Heavy'
                                      : '⚖️ Medium'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                    sub.apiKey
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-stone-100 text-stone-500 border border-stone-200'
                                  }`}
                                >
                                  {sub.apiKey ? '✓ Key Set' : 'No Key'}
                                </span>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteSubModel(selectedProfileForEdit.id, sub.id);
                                  }}
                                  className="p-1 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] hover:border-red-400 text-[#7C756E] hover:text-red-600 cursor-pointer transition-all"
                                  title="Remove this model"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>

                            {/* Expanded Content */}
                            {isOpen && (
                              <div className="p-4 pt-3 border-t border-[#E6DFD3] space-y-3.5 bg-white animate-in fade-in duration-100">
                                {/* Job Tier Selector (Clean 3-Button Row - No Overflow) */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[10px] font-bold text-[#2C2825]">
                                      Job Tier & Routing Role
                                    </label>
                                    <span className="text-[10px] text-[#7C756E]">
                                      Select when this model is routed
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { role: 'flash' })
                                      }
                                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                        sub.role === 'flash'
                                          ? 'bg-[#FAF8F5] border-[#C58B51] ring-1 ring-[#C58B51]/30 shadow-2xs'
                                          : 'bg-white border-[#E6DFD3] hover:border-[#D9CFBF] hover:bg-[#FAF8F5]/40'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-0.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-xs">⚡</span>
                                          <span className="text-xs font-bold text-[#2C2825]">Small / Flash</span>
                                        </div>
                                        {sub.role === 'flash' && <Check size={12} className="text-[#C58B51]" />}
                                      </div>
                                      <p className="text-[10px] text-[#7C756E] leading-tight">
                                        Quick greetings, small queries & fast checks
                                      </p>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { role: 'medium' })
                                      }
                                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                        sub.role === 'medium'
                                          ? 'bg-[#FAF8F5] border-[#C58B51] ring-1 ring-[#C58B51]/30 shadow-2xs'
                                          : 'bg-white border-[#E6DFD3] hover:border-[#D9CFBF] hover:bg-[#FAF8F5]/40'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-0.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-xs">⚖️</span>
                                          <span className="text-xs font-bold text-[#2C2825]">Medium</span>
                                        </div>
                                        {sub.role === 'medium' && <Check size={12} className="text-[#C58B51]" />}
                                      </div>
                                      <p className="text-[10px] text-[#7C756E] leading-tight">
                                        General coding, chat & standard tasks
                                      </p>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { role: 'heavy' })
                                      }
                                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                        sub.role === 'heavy'
                                          ? 'bg-[#FAF8F5] border-[#C58B51] ring-1 ring-[#C58B51]/30 shadow-2xs'
                                          : 'bg-white border-[#E6DFD3] hover:border-[#D9CFBF] hover:bg-[#FAF8F5]/40'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-0.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-xs">🧠</span>
                                          <span className="text-xs font-bold text-[#2C2825]">Large / Heavy</span>
                                        </div>
                                        {sub.role === 'heavy' && <Check size={12} className="text-[#C58B51]" />}
                                      </div>
                                      <p className="text-[10px] text-[#7C756E] leading-tight">
                                        Complex refactors, deep reasoning & full edits
                                      </p>
                                    </button>
                                  </div>
                                </div>

                                {/* SubModel Name & Model Identifier */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      Model Display Name
                                    </label>
                                    <input
                                      type="text"
                                      value={sub.name}
                                      onChange={(e) =>
                                        handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { name: e.target.value })
                                      }
                                      placeholder={`e.g. Model #${modelNumber}, Gemini Flash`}
                                      className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      Model Identifier (API Parameter)
                                    </label>
                                    <input
                                      type="text"
                                      value={sub.model}
                                      onChange={(e) =>
                                        handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { model: e.target.value })
                                      }
                                      placeholder="e.g. gemini-1.5-flash, deepseek-chat, gpt-4o-mini"
                                      className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                                    />
                                  </div>
                                </div>

                                {/* Base URL & API Key */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      Base URL (OpenAI-Compatible)
                                    </label>
                                    <input
                                      type="text"
                                      value={sub.baseUrl}
                                      onChange={(e) =>
                                        handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { baseUrl: e.target.value })
                                      }
                                      placeholder="https://api.openai.com/v1"
                                      className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                      API Key / Secret
                                    </label>
                                    <div className="relative">
                                      <input
                                        type={showKeyMap[sub.id] ? 'text' : 'password'}
                                        value={sub.apiKey}
                                        onChange={(e) =>
                                          handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { apiKey: e.target.value })
                                        }
                                        placeholder="sk-... or API secret"
                                        className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono pr-8"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setShowKeyMap((prev) => ({
                                            ...prev,
                                            [sub.id]: !prev[sub.id],
                                          }))
                                        }
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                                      >
                                        {showKeyMap[sub.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                {/* Custom Headers */}
                                <div>
                                  <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                                    Custom Headers (Optional JSON)
                                  </label>
                                  <input
                                    type="text"
                                    value={sub.customHeaders || ''}
                                    onChange={(e) =>
                                      handleUpdateSubModel(selectedProfileForEdit.id, sub.id, { customHeaders: e.target.value })
                                    }
                                    placeholder='{"HTTP-Referer": "https://..."}'
                                    className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                                  />
                                </div>

                                {/* Test Connection Button & Result for SubModel */}
                                <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-bold text-[#2C2825]">
                                      Verify Model #{modelNumber} Connection
                                    </div>
                                    {pingMessageMap[sub.id] && (
                                      <div
                                        className={`text-[10px] mt-0.5 font-medium flex items-start gap-1.5 ${
                                          pingStatusMap[sub.id] === 'success'
                                            ? 'text-emerald-700'
                                            : pingStatusMap[sub.id] === 'error'
                                            ? 'text-amber-800'
                                            : 'text-[#7C756E]'
                                        }`}
                                      >
                                        {pingStatusMap[sub.id] === 'success' ? (
                                          <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
                                        ) : pingStatusMap[sub.id] === 'error' ? (
                                          <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                        ) : (
                                          <RefreshCw size={12} className="shrink-0 animate-spin text-[#C58B51] mt-0.5" />
                                        )}
                                        <div className="truncate">
                                          <span>{pingMessageMap[sub.id]}</span>
                                          {detectedInfoMap[sub.id] && (
                                            <div className="text-[9px] text-[#7C756E] font-mono">
                                              {detectedInfoMap[sub.id]}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      testProfileConnection(sub.id, sub.baseUrl, sub.apiKey, sub.model, sub.customHeaders)
                                    }
                                    disabled={pingStatusMap[sub.id] === 'testing'}
                                    className="px-3 py-1.5 rounded-lg bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-bold text-[#2C2825] shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                                  >
                                    <RefreshCw
                                      size={11}
                                      className={
                                        pingStatusMap[sub.id] === 'testing'
                                          ? 'animate-spin text-[#C58B51]'
                                          : ''
                                      }
                                    />
                                    <span>
                                      {pingStatusMap[sub.id] === 'testing'
                                        ? 'Testing...'
                                        : 'Test Connection'}
                                    </span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* --- ADD MODEL BUTTON (Max 3 Tables) --- */}
                      {(selectedProfileForEdit.subModels?.length || 0) < 2 ? (
                        <button
                          type="button"
                          onClick={() => handleAddSubModel(selectedProfileForEdit.id)}
                          className="w-full py-2.5 px-4 rounded-xl border border-dashed border-[#C58B51] bg-[#FAF8F5] hover:bg-[#F5F1EA] text-[#C58B51] hover:text-[#B07A43] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all shadow-2xs"
                        >
                          <Plus size={14} />
                          <span>Add Model ({(selectedProfileForEdit.subModels?.length || 0) + 1}/3 Configured)</span>
                        </button>
                      ) : (
                        <div className="text-center py-2 px-3 bg-[#FAF8F5] rounded-xl border border-[#E6DFD3] text-[11px] font-medium text-[#7C756E]">
                          ✓ Maximum 3 models configured for this profile (Smart Task Routing Active across Small, Medium & Large)
                        </div>
                      )}
                          </>
                        );
                      })()}
                    </div>

                    {/* Max Tokens Limit for this Profile */}
                    <div className="pt-2">
                      <label className="block text-xs font-bold text-[#2C2825] mb-1">
                        Max Tokens Limit (0 = Unlimited)
                      </label>
                      <input
                        type="number"
                        value={selectedProfileForEdit.maxTokens || 0}
                        onChange={(e) =>
                          handleUpdateProfile(selectedProfileForEdit.id, { maxTokens: Number(e.target.value) || 0 })
                        }
                        placeholder="e.g. 16384 (0 for unlimited)"
                        className="w-full px-2.5 py-2 rounded-xl text-xs bg-white border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                      />
                    </div>

                    {/* System Prompt for this AI */}
                    <div className="pt-2">
                      <label className="block text-xs font-bold text-[#2C2825] mb-1">
                        System Prompt for this AI Profile Suite
                      </label>
                      <textarea
                        rows={2}
                        value={selectedProfileForEdit.systemPrompt || ''}
                        onChange={(e) =>
                          handleUpdateProfile(selectedProfileForEdit.id, { systemPrompt: e.target.value })
                        }
                        placeholder="You are a senior AI programming assistant..."
                        className="w-full p-2.5 rounded-xl text-xs bg-white border border-[#E6DFD3] focus:border-[#C58B51] outline-none leading-relaxed"
                      />
                    </div>
                  </div>
                  ) : (
                    <div className="md:col-span-7 p-5 rounded-2xl border border-[#E6DFD3] bg-[#FAF8F5] flex flex-col items-center justify-center text-[#7C756E] min-h-[300px]">
                      <p className="text-xs font-medium">Select or create a profile to edit its settings.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2. AGENT SKILLS TAB */}
            {activeTab === 'skills' && (
              <SkillsTab
                skills={formData.skills || []}
                onUpdateSkills={(updatedSkills) =>
                  setFormData({ ...formData, skills: updatedSkills })
                }
                onOpenAddModal={(skillToEdit) => {
                  setEditingSkill(skillToEdit || null);
                  setIsAddSkillModalOpen(true);
                }}
              />
            )}

            {/* 3. WEB SEARCH TAB */}
            {activeTab === 'search' && (
              <div className="space-y-6">
              
                <div className="p-4 rounded-xl border border-[#E6DFD3] bg-white shadow-2xs space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-[#2C2825] flex items-center gap-2">
                      <Code size={16} className="text-[#C58B51]" />
                      AI Workspace Automation Mode
                    </h4>
                    <p className="text-xs text-[#7C756E] mt-1 max-w-lg">
                      Controls how the AI interacts with your project files when writing or editing code.
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, automationMode: 'automatic' })}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        (formData.automationMode || 'automatic') === 'automatic'
                          ? 'border-[#C58B51] bg-[#FAF8F5]'
                          : 'border-[#E6DFD3] bg-white hover:border-[#D9CFBF]'
                      }`}
                    >
                      <h5 className={`text-xs font-bold ${
                        (formData.automationMode || 'automatic') === 'automatic' ? 'text-[#C58B51]' : 'text-[#2C2825]'
                      }`}>🚀 Fully Automatic</h5>
                      <p className="text-[10px] text-[#7C756E] mt-1">
                        AI autonomously creates and modifies files directly in your project workspace.
                      </p>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, automationMode: 'review' })}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        formData.automationMode === 'review'
                          ? 'border-[#C58B51] bg-[#FAF8F5]'
                          : 'border-[#E6DFD3] bg-white hover:border-[#D9CFBF]'
                      }`}
                    >
                      <h5 className={`text-xs font-bold ${
                        formData.automationMode === 'review' ? 'text-[#C58B51]' : 'text-[#2C2825]'
                      }`}>👀 Review Requests</h5>
                      <p className="text-[10px] text-[#7C756E] mt-1">
                        AI proposes file changes as artifacts in the chat. You must manually accept or reject each modification.
                      </p>
                    </button>
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3]">
                  <div className="flex items-center gap-2 mb-1">
                    <Globe size={16} className="text-[#C58B51]" />
                    <h4 className="text-xs font-bold text-[#2C2825]">Built-In Web Grounding (Free & Universal)</h4>
                  </div>
                  <p className="text-xs text-[#7C756E] leading-relaxed">
                    Real-time web search returns ranked results from DuckDuckGo (including weather, news, and live
                    data) and injects ground-truth citations into the prompt before the answer is generated. For the
                    highest-quality results, add a Tavily API key.
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-[#E6DFD3] bg-white">
                  <div>
                    <div className="text-xs font-bold text-[#2C2825]">Default Web Search Toggle</div>
                    <div className="text-[11px] text-[#7C756E]">Enable web search grounding for all new queries by default</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.webSearchEnabled}
                    onChange={(e) => setFormData({ ...formData, webSearchEnabled: e.target.checked })}
                    className="w-4 h-4 accent-[#C58B51] cursor-pointer"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[#2C2825] mb-1.5 block">Search Provider</label>
                  <select
                    value={formData.webSearchProvider || 'duckduckgo_wikipedia'}
                    onChange={(e) => setFormData({ ...formData, webSearchProvider: e.target.value as 'duckduckgo' | 'wikipedia' | 'duckduckgo_wikipedia' | 'tavily' })}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6DFD3] bg-white text-xs text-[#2C2825] focus:outline-none focus:ring-2 focus:ring-[#C58B51]/40"
                  >
                    <option value="duckduckgo_wikipedia">DuckDuckGo + Wikipedia (free, no key — best free coverage)</option>
                    <option value="duckduckgo">DuckDuckGo (free, no key — weather/news/live data)</option>
                    <option value="wikipedia">Wikipedia (free, no key — encyclopedic lookups)</option>
                    <option value="tavily">Tavily (best quality — needs API key below)</option>
                  </select>
                </div>

                {(formData.webSearchProvider || 'duckduckgo_wikipedia') === 'tavily' && (
                  <div>
                    <label className="text-xs font-bold text-[#2C2825] mb-1.5 block">Tavily API Key</label>
                    <input
                      type="password"
                      value={formData.webSearchApiKey || ''}
                      onChange={(e) => setFormData({ ...formData, webSearchApiKey: e.target.value })}
                      placeholder="tvly-..."
                      className="w-full px-3 py-2 rounded-lg border border-[#E6DFD3] bg-white text-xs text-[#2C2825] focus:outline-none focus:ring-2 focus:ring-[#C58B51]/40"
                    />
                    <p className="text-[10px] text-[#7C756E] mt-1">Get a free key at tavily.com. Stored locally only.</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-[#2C2825]">Maximum Search Results Context</label>
                    <span className="text-[11px] font-mono text-[#C58B51] font-bold">
                      {formData.webSearchMaxResults} snippets
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={formData.webSearchMaxResults}
                    onChange={(e) =>
                      setFormData({ ...formData, webSearchMaxResults: Number(e.target.value) })
                    }
                    className="w-full accent-[#C58B51] cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* 4. MCP PROTOCOL TAB */}
            {activeTab === 'mcp' && (
              <MCPTab
                servers={formData.mcpServers || []}
                onUpdateServers={(servers) => setFormData({ ...formData, mcpServers: servers })}
              />
            )}

            {/* 5. BACKUP & DATA TAB */}
            {activeTab === 'data' && (
              <div className="space-y-6">
                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3]">
                  <div className="flex items-center gap-2 mb-1">
                    <Database size={16} className="text-[#C58B51]" />
                    <h4 className="text-xs font-bold text-[#2C2825]">Local Storage & Data Portability</h4>
                  </div>
                  <p className="text-xs text-[#7C756E] leading-relaxed">
                    All your projects, custom chat threads, raw memory files, skills bundles, and SAW AI credentials are stored locally in your browser sandbox.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-[#E6DFD3] bg-white flex flex-col justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-[#2C2825] mb-1">Export Workspace Backup</h5>
                      <p className="text-[11px] text-[#7C756E] mb-4">
                        Download all projects, chats, artifacts, skills, and settings as a clean JSON file.
                      </p>
                    </div>
                    <button
                      onClick={handleExportBackup}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-bold text-[#2C2825] transition-all cursor-pointer shadow-2xs"
                    >
                      <Download size={14} className="text-[#C58B51]" />
                      <span>Download JSON Backup</span>
                    </button>
                  </div>

                  <div className="p-4 rounded-xl border border-[#E6DFD3] bg-white flex flex-col justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-[#2C2825] mb-1">Restore from Backup</h5>
                      <p className="text-[11px] text-[#7C756E] mb-4">
                        Import a previously exported JSON backup file to restore your workspace.
                      </p>
                    </div>
                    <label className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-bold text-[#2C2825] transition-all cursor-pointer shadow-2xs">
                      <Upload size={14} className="text-[#C58B51]" />
                      <span>Select Backup File</span>
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImportBackup}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {importStatus && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                    {importStatus}
                  </div>
                )}

                {/* Live Flutter preview via real DartPad (gist-based embed) */}
                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3]">
                  <div className="flex items-center gap-2 mb-1">
                    <Flame size={16} className="text-[#C58B51]" />
                    <h4 className="text-xs font-bold text-[#2C2825]">Live Flutter Preview (DartPad)</h4>
                  </div>
                  <p className="text-xs text-[#7C756E] leading-relaxed mb-3">
                    Google deprecated DartPad's free source-injection, so to render the AI's Flutter
                    code in a real DartPad canvas we push it to an anonymous GitHub gist and embed
                    the gist. Paste a GitHub token with the <code className="font-mono">gist</code> scope
                    to enable live previews. Without it, a faithful structural widget-tree preview is used.
                  </p>
                  <div className="rounded-xl bg-white border border-[#E6DFD3] p-2.5 mb-3 text-[10px] text-[#7C756E] leading-relaxed">
                    <span className="font-bold text-[#2C2825]">How to get a token:</span><br />
                    1. Go to <span className="font-mono text-[#C58B51]">github.com → Settings → Developer settings → Personal access tokens</span><br />
                    2. Pick <span className="font-bold">"Tokens (classic)"</span> → <span className="font-bold">Generate new token (classic)</span><br />
                    3. Tick the <span className="font-mono text-[#C58B51]">gist</span> scope (everything else can stay unticked)<br />
                    4. Generate, then copy the <span className="font-mono">ghp_…</span> token and paste it here. (Stored locally only — never sent anywhere except GitHub's gist API.)
                  </div>
                  <label className="block text-[10px] font-bold text-[#2C2825] mb-1">
                    GitHub Gist Token (optional)
                  </label>
                  <input
                    type="password"
                    value={formData.gistToken || ''}
                    onChange={(e) => setFormData({ ...formData, gistToken: e.target.value })}
                    placeholder="github_pat… or ghp_… (needs gist scope)"
                    className="w-full px-3 py-2 rounded-xl border border-[#E6DFD3] bg-white text-xs font-mono text-[#2C2825] focus:outline-none focus:border-[#C58B51]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Modal Bottom Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[#E6DFD3] bg-[#FAF8F5]">
            <div className="flex items-center gap-2 text-xs text-[#7C756E]">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>All API keys & skills persist in local browser storage</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-[#E6DFD3] bg-white text-xs font-bold text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-2 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-xs font-bold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Check size={14} />
                <span>Save Settings</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add / Edit Skill Modal */}
      {isAddSkillModalOpen && (
        <AddSkillModal
          isOpen={isAddSkillModalOpen}
          onClose={() => {
            setIsAddSkillModalOpen(false);
            setEditingSkill(null);
          }}
          initialSkill={editingSkill}
          onSaveSkill={(savedSkill) => {
            const currentSkills = formData.skills || [];
            const exists = currentSkills.some((s) => s.id === savedSkill.id);
            const updated = exists
              ? currentSkills.map((s) => (s.id === savedSkill.id ? savedSkill : s))
              : [...currentSkills, savedSkill];

            setFormData({ ...formData, skills: updated });
            setIsAddSkillModalOpen(false);
            setEditingSkill(null);
          }}
        />
      )}
    </>
  );
};
