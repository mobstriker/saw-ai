import { AIProfile, SubModelConfig } from '../types';

export type TaskRole = 'flash' | 'medium' | 'heavy';

export interface ResolvedModelTarget {
  role: TaskRole;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders?: string;
  assignedForTask: TaskRole;
  routingReason: string;
}

export const ModelRouter = {
  /**
   * Evaluates the user's prompt, reasoning level, and task context to determine
   * whether this query needs a Flash (small/fast), Medium (standard), or Heavy (large/reasoning) model.
   */
  classifyTask(prompt: string, reasoningMode?: string, isFileOperation?: boolean): TaskRole {
    const clean = (prompt || '').trim().toLowerCase();

    // 1. Small / Flash Triggers (Strictly short greetings, casual conversation, chit-chat, quick ping, definitions)
    const isShortGreeting =
      clean === 'hello' ||
      clean === 'hi' ||
      clean === 'hey' ||
      clean === 'how are you' ||
      clean === 'whats up' ||
      clean === "what's up" ||
      clean === 'ping' ||
      clean === 'ok' ||
      clean === 'okay' ||
      clean === 'thanks' ||
      clean === 'thank you' ||
      clean === 'cool' ||
      clean === 'great' ||
      clean === 'awesome' ||
      clean === 'good morning' ||
      clean === 'good evening' ||
      clean === 'good night';

    const isConversational =
      isShortGreeting ||
      clean.includes('i just want to talk') ||
      clean.includes('just want to talk') ||
      clean.includes('want to talk') ||
      clean.includes('want to chat') ||
      clean.includes('can we talk') ||
      clean.includes('can we chat') ||
      clean.includes('let\'s talk') ||
      clean.includes('lets talk') ||
      clean.includes('let\'s chat') ||
      clean.includes('lets chat') ||
      clean.includes('talk to me') ||
      clean.includes('tell me a joke') ||
      clean.includes('tell me a story') ||
      clean.includes('who are you') ||
      clean.includes('what can you do');

    // Never classify as flash if it's a file operation or contains coding instructions
    if (!isFileOperation && isConversational && clean.split(/\s+/).length <= 10) {
      return 'flash';
    }

    // 2. Heavy / Deep Reasoning Triggers (Complex system architecture, multi-file refactors, deep algorithmic analysis, high reasoning)
    const isHeavyTask =
      clean.includes('rewrite the entire') ||
      clean.includes('full system architecture') ||
      clean.includes('architect a full') ||
      clean.includes('database migration') ||
      clean.includes('memory leak profiling') ||
      clean.includes('trace complex stack') ||
      clean.includes('mathematical proof') ||
      clean.includes('complex algorithm optimization') ||
      clean.includes('security audit') ||
      clean.includes('full refactor') ||
      (clean.split(/\s+/).length > 60 && (clean.includes('architecture') || clean.includes('full stack') || clean.includes('refactor') || clean.includes('schema') || clean.includes('optimize')));

    if (isHeavyTask || ((reasoningMode === 'high' || reasoningMode === 'extra_high') && !isConversational)) {
      return 'heavy';
    }

    // 3. Medium (Standard coding tasks, component creation, targeted edits, explanations, bug fixes, Q&A, feature updates)
    return 'medium';
  },

  /**
   * Resolves the exact model, baseUrl, apiKey, and headers to use based on the
   * configured AI Profile and the requested task complexity role.
   *
   * Seamless Routing Rules for 1, 2, or 3 models:
   * - 1 Model: Handles all tasks automatically (Flash, Medium, Heavy).
   * - 2 Models:
   *   * Large ('heavy') + Small ('flash'): Flash handles Flash; Large handles Medium & Heavy.
   *   * Large ('heavy') + Medium ('medium'): Medium handles Flash & Medium; Large handles Heavy.
   *   * Medium ('medium') + Small ('flash'): Flash handles Flash; Medium handles Medium & Heavy.
   * - 3 Models: Each dedicated tier handles its own task; fallback seamlessly if roles overlap.
   */
  resolveModel(activeProfile?: AIProfile | null, requestedTaskRole: TaskRole = 'medium'): ResolvedModelTarget {
    const defaultTarget: ResolvedModelTarget = {
      role: 'medium',
      name: 'Default AI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o',
      customHeaders: '',
      assignedForTask: requestedTaskRole,
      routingReason: 'Default fallback',
    };

    if (!activeProfile) return defaultTarget;

    const subModels = activeProfile.subModels || [];

    // Case 1: ONLY 1 MODEL CONFIGURED
    // When there is only one model, that single model automatically does ALL jobs.
    if (subModels.length === 0) {
      return {
        role: activeProfile.mainModelRole || 'medium',
        name: activeProfile.name || activeProfile.model || 'Primary AI',
        baseUrl: activeProfile.baseUrl || 'https://api.openai.com/v1',
        apiKey: activeProfile.apiKey || '',
        model: activeProfile.model || 'gpt-4o',
        customHeaders: activeProfile.customHeaders || '',
        assignedForTask: requestedTaskRole,
        routingReason: 'Single model handles all workspace tasks',
      };
    }

    // Collect all configured models (Model #1 primary + sub-models)
    const allModels: {
      role: TaskRole;
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      customHeaders?: string;
    }[] = [
      {
        role: activeProfile.mainModelRole || 'medium',
        name: activeProfile.name || 'Primary Model',
        baseUrl: (activeProfile.baseUrl && activeProfile.baseUrl.trim()) || 'https://api.openai.com/v1',
        apiKey: (activeProfile.apiKey && activeProfile.apiKey.trim()) || '',
        model: (activeProfile.model && activeProfile.model.trim()) || 'gpt-4o',
        customHeaders: activeProfile.customHeaders,
      },
      ...subModels.map((s) => ({
        role: s.role,
        name: s.name || `Model (${s.role})`,
        baseUrl: (s.baseUrl && s.baseUrl.trim()) || (activeProfile.baseUrl && activeProfile.baseUrl.trim()) || 'https://api.openai.com/v1',
        apiKey: (s.apiKey && s.apiKey.trim()) || (activeProfile.apiKey && activeProfile.apiKey.trim()) || '',
        model: (s.model && s.model.trim()) || (activeProfile.model && activeProfile.model.trim()) || 'gpt-4o',
        customHeaders: s.customHeaders || activeProfile.customHeaders,
      })),
    ];

    const hasHeavy = allModels.some((m) => m.role === 'heavy');
    const hasMedium = allModels.some((m) => m.role === 'medium');
    const hasFlash = allModels.some((m) => m.role === 'flash');

    let selectedModel = allModels[0];
    let reason = '';

    // Case 2: EXACTLY 2 MODELS CONFIGURED
    if (allModels.length === 2) {
      // Combination A: Large ('heavy') and Small ('flash')
      if (hasHeavy && hasFlash && !hasMedium) {
        const heavyModel = allModels.find((m) => m.role === 'heavy')!;
        const flashModel = allModels.find((m) => m.role === 'flash')!;

        if (requestedTaskRole === 'flash') {
          selectedModel = flashModel;
          reason = '2-Model Suite (Heavy + Flash): Flash handled by Small/Flash model';
        } else {
          // Both medium and heavy jobs handled by large model
          selectedModel = heavyModel;
          reason = `2-Model Suite (Heavy + Flash): ${requestedTaskRole === 'heavy' ? 'Heavy' : 'Medium'} routed to Large/Heavy model`;
        }
      }
      // Combination B: Large ('heavy') and Medium ('medium')
      else if (hasHeavy && hasMedium && !hasFlash) {
        const heavyModel = allModels.find((m) => m.role === 'heavy')!;
        const mediumModel = allModels.find((m) => m.role === 'medium')!;

        if (requestedTaskRole === 'heavy') {
          selectedModel = heavyModel;
          reason = '2-Model Suite (Heavy + Medium): Heavy routed to Large/Heavy model';
        } else {
          // Both small/flash and medium jobs handled by medium model
          selectedModel = mediumModel;
          reason = `2-Model Suite (Heavy + Medium): ${requestedTaskRole === 'flash' ? 'Small/Flash' : 'Medium'} routed to Medium model`;
        }
      }
      // Combination C: Medium ('medium') and Small ('flash')
      else if (hasMedium && hasFlash && !hasHeavy) {
        const mediumModel = allModels.find((m) => m.role === 'medium')!;
        const flashModel = allModels.find((m) => m.role === 'flash')!;

        if (requestedTaskRole === 'flash') {
          selectedModel = flashModel;
          reason = '2-Model Suite (Medium + Flash): Flash routed to Small/Flash model';
        } else {
          // Both medium and large/heavy jobs handled by medium model
          selectedModel = mediumModel;
          reason = `2-Model Suite (Medium + Flash): ${requestedTaskRole === 'heavy' ? 'Heavy' : 'Medium'} routed to Medium model`;
        }
      }
      // Combination D: Both models have identical roles (e.g. both heavy, both medium, or both flash)
      else {
        const exactMatch = allModels.find((m) => m.role === requestedTaskRole);
        selectedModel = exactMatch || allModels[0];
        reason = `2-Model Suite: Routed to ${selectedModel.role} model`;
      }
    }
    // Case 3: 3 MODELS CONFIGURED (or general fallback)
    else {
      const exactMatch = allModels.find((m) => m.role === requestedTaskRole);
      if (exactMatch) {
        selectedModel = exactMatch;
        reason = `3-Model Suite: Dedicated ${requestedTaskRole} tier model selected`;
      } else {
        // Hierarchical fallback
        if (requestedTaskRole === 'heavy') {
          selectedModel = allModels.find((m) => m.role === 'medium') || allModels.find((m) => m.role === 'flash') || allModels[0];
          reason = `Fallback: Heavy task routed to available ${selectedModel.role} model`;
        } else if (requestedTaskRole === 'flash') {
          selectedModel = allModels.find((m) => m.role === 'medium') || allModels.find((m) => m.role === 'heavy') || allModels[0];
          reason = `Fallback: Flash task routed to available ${selectedModel.role} model`;
        } else {
          selectedModel = allModels.find((m) => m.role === 'heavy') || allModels.find((m) => m.role === 'flash') || allModels[0];
          reason = `Fallback: Medium task routed to available ${selectedModel.role} model`;
        }
      }
    }

    return {
      role: selectedModel.role,
      name: selectedModel.name,
      baseUrl: (selectedModel.baseUrl && selectedModel.baseUrl.trim()) || (activeProfile.baseUrl && activeProfile.baseUrl.trim()) || 'https://api.openai.com/v1',
      apiKey: (selectedModel.apiKey && selectedModel.apiKey.trim()) || (activeProfile.apiKey && activeProfile.apiKey.trim()) || '',
      model: (selectedModel.model && selectedModel.model.trim()) || (activeProfile.model && activeProfile.model.trim()) || 'gpt-4o',
      customHeaders: selectedModel.customHeaders !== undefined ? selectedModel.customHeaders : activeProfile.customHeaders,
      assignedForTask: requestedTaskRole,
      routingReason: reason,
    };
  },
};
