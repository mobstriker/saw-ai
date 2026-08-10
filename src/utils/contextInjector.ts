import { Project, ProjectFile, FolderNode, Skill } from '../types';
import { FileSecurity } from './fileSecurity';

/**
 * Pure Context Injection Engine
 * Holds all files in the selected project folder in memory as raw UTF-8 text
 * and injects them directly into the API prompt context to guarantee 100% full-file
 * retention without vector chunking or RAG information loss.
 */
export const ContextInjector = {
  /**
   * Approximate token count for a text string (~4 characters per token heuristic)
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.8);
  },

  /**
   * Injects active Agent Skills and their SKILL.md instructions into the model context
   */
  buildSkillsPromptContext(
    skills: Skill[],
    enabledSkillIds?: string[],
    userPrompt?: string
  ): {
    promptText: string;
    activeSkills: Skill[];
    appliedSkillNames: string[];
  } {
    if (!skills || skills.length === 0) {
      return { promptText: '', activeSkills: [], appliedSkillNames: [] };
    }

    const lowerPrompt = (userPrompt || '').toLowerCase();

    // Determine which skills are active:
    // 1. Explicitly enabled for this chat session (or default enabled if none specified)
    // 2. OR automatically referenced / triggered by words in the prompt (e.g. "use skill: python-data-analyst", "refactor", "api spec", "test suite")
    const activeSkills = skills.filter((skill) => {
      // Check if skill ID is in enabledSkillIds
      const isEnabledInChat = enabledSkillIds
        ? enabledSkillIds.includes(skill.id)
        : skill.enabledByDefault ?? false;

      // Check for prompt-based automatic trigger or explicit mention
      const isMentionedInPrompt =
        lowerPrompt.includes(skill.name.toLowerCase()) ||
        (skill.folderName && lowerPrompt.includes(skill.folderName.toLowerCase())) ||
        lowerPrompt.includes(`skill: ${skill.name.toLowerCase()}`) ||
        lowerPrompt.includes(`skill:${skill.name.toLowerCase()}`);

      return isEnabledInChat || isMentionedInPrompt;
    });

    if (activeSkills.length === 0) {
      return { promptText: '', activeSkills: [], appliedSkillNames: [] };
    }

    const skillBlocks = activeSkills
      .map((skill) => {
        const skillMd = skill.files.find((f) => f.name.toLowerCase() === 'skill.md') || skill.files[0];
        const companionFiles = skill.files.filter((f) => f !== skillMd);

        const companionText =
          companionFiles.length > 0
            ? `\nAttached Companion Scripts & Templates in /skills/${skill.folderName || skill.name}:\n` +
              companionFiles
                .map((f) => `--- File: ${f.path} (${f.language || 'code'}) ---\n${f.content}\n--- End File ---`)
                .join('\n\n')
            : '';

        return `### Skill: "${skill.name}" (ID: ${skill.folderName || skill.id})
Description: ${skill.description}
${skill.triggerConditions ? `Triggers / Rules: ${skill.triggerConditions}\n` : ''}
--- Instructions (SKILL.md) ---
${skillMd ? skillMd.content : 'Follow expert standards for this domain.'}
--- End SKILL.md ---${companionText}`;
      })
      .join('\n\n========================================\n\n');

    const promptText = `=== ACTIVE AGENT SKILLS & SPECIALIZED CAPABILITIES ===
The following ${activeSkills.length} skill bundle(s) are active for this conversation. You must adhere strictly to the guidelines, constraints, and companion script workflows documented below:

${skillBlocks}

Directive:
- If a skill provides specific architectural patterns, typography scales, or clean code rules, execute them faithfully.
- You may use and reference any companion python/node/template files provided in the skill packages.
=== END ACTIVE SKILLS ===\n\n`;

    return {
      promptText,
      activeSkills,
      appliedSkillNames: activeSkills.map((s) => s.name),
    };
  },

  /**
   * Formats the raw project workspace files into a clean, LLM-optimized context block
   */
  buildProjectPromptContext(project: Project): {
    promptText: string;
    totalFiles: number;
    includedFilesCount: number;
    estimatedTokens: number;
    totalCharacters: number;
  } {
    const includedFiles = project.files.filter((f) => f.includedInContext !== false);

    if (includedFiles.length === 0) {
      return {
        promptText: '',
        totalFiles: project.files.length,
        includedFilesCount: 0,
        estimatedTokens: 0,
        totalCharacters: 0,
      };
    }

    const fileHeaders = includedFiles
      .map((f) => `- ${f.path} (${f.language || 'code'}, ${f.content.length} chars)`)
      .join('\n');

    const fileBlocks = includedFiles
      .map((f) => {
        return `[FILE START: ${f.path}]\n${f.content}\n[FILE END: ${f.path}]`;
      })
      .join('\n\n');

    const instructionsBlock = project.instructions
      ? `Project Instructions / Directives for AI:\n${project.instructions}\n\n`
      : '';

    const promptText = `=== PURE CONTEXT INJECTION (Ground-Truth Project Workspace) ===
Project: "${project.name}"
Description: ${project.description || 'Custom User Workspace'}
Files Injected: ${includedFiles.length} / ${project.files.length}

${instructionsBlock}Workspace Manifest:
${fileHeaders}

--- BEGIN RAW GROUND TRUTH SOURCE FILES ---
${fileBlocks}
--- END RAW GROUND TRUTH SOURCE FILES ---

Directives for the Assistant:
1. Follow all Project Instructions and architectural directives specified above.
2. Treat the above files as the absolute ground-truth state of this workspace. You have direct 100% full-file in-memory read, write, create, delete, and editing access to this project workspace.

3. 🔍 DEEP FILE SCANNING & CODE ANALYSIS (CRITICAL):
   - When asked to scan, read, examine, inspect, review, evaluate, or list files in the workspace:
     - You have the EXACT complete source code of all files in memory directly above.
     - Never output generic acknowledgments like "I have completed your request" without doing the full analysis.
     - Cite exact filenames, line numbers, function names, types, and logic structures from the source code.
     - Provide actionable, deep, multi-dimensional feedback covering architecture, state flow, syntax, error handling, and performance.

4. 📋 STRUCTURED OUTPUT & FORMATTING (Gemini & Claude Developer Standard):
   - Always structure your file listings, directory breakdowns, and analytical reports using clean markdown bullet hierarchies with minus fields:
     - **File Path / Module**:
       - Language & Size: \`tsx / python / json\` (~X lines)
       - Primary Responsibility: Concise description of component or logic.
       - Key Exports / Functions: \`exportedFunction()\`, \`Component\`
       - Dependencies & Imports: \`lucide-react\`, \`../types\`
       - Observations / Suggestions: Code quality, security, or optimization points.
   - For high-level summaries, organize your findings under clear headings:
     - ### 📂 Workspace Architecture & Manifest
     - ### 🔬 Deep Code Scan & Logic Review
     - ### 💡 Key Insights, Strengths & Recommendations

5. ⚡ SURGICAL TARGETED EDITS (CRITICAL RULE FOR ALL MODIFICATIONS & BUG FIXES):
   - When modifying existing files, fixing bugs, refactoring, updating styles, or adding features to existing files:
     **DO NOT REWRITE THE ENTIRE FILE.**
   - Rewriting whole files wastes thousands of tokens, is slow, and accidentally deletes existing functions, comments, or imports.
   - Always output targeted Claude/Aider-style SEARCH / REPLACE blocks containing ONLY the lines being changed with 2-4 lines of exact surrounding context:
<<<<<<< SEARCH: src/components/Header.tsx
// Exact existing lines of code in the file
const [count, setCount] = useState(0);
=======
// New replacement lines of code
const [count, setCount] = useState(initialCount);
const [isActive, setIsActive] = useState(true);
>>>>>>> REPLACE
   - You can output multiple SEARCH / REPLACE blocks for different parts of the same file or across multiple files in a single turn.
   - The workspace engine automatically matches and applies the patch surgically into the file with instant diff visualization, token savings stats, and 100% preservation of untouched code.

6. FULL FILE CREATION & BRAND-NEW FILES:
   - When creating a BRAND-NEW file that does not exist yet in the workspace (or doing an absolute 100% full rewrite):
     Output a standard code block with the exact file path on the first line:
\`\`\`tsx
// src/components/NewFeatureModal.tsx
import React from 'react';
// full new component code...
\`\`\`
   - The workspace engine automatically creates all necessary nested folders and files.

7. TREE STRUCTURE & DELETIONS:
   - To delete an obsolete file: Output \`[DELETE_FILE path="src/oldFile.ts"]\`
   - To delete an obsolete folder: Output \`[DELETE_FOLDER path="src/legacy"]\`
   - To create an empty directory: Output \`[CREATE_FOLDER path="src/components/auth"]\`

8. CLARIFICATION REQUESTS (ONLY FOR COMPLEX, AMBIGUOUS ENGINEERING REQUIREMENTS):
   - NEVER output clarification requests for casual conversation, chit-chat, small talk, questions about thoughts or feelings, code reviews, file scans, or simple greetings. Reply naturally in plain conversational text or structured markdown.
   - ONLY if the user asks to build or refactor a complex application or feature with missing architectural decisions, output a friendly introductory sentence and format the clarification requests as:
\`\`\`json
{
  "clarification_requests": [
    {
      "question": "What primary database or state storage do you prefer?",
      "options": ["PostgreSQL with Prisma", "Client-side IndexedDB", "Supabase Backend"]
    }
  ]
}
\`\`\`

9. Always provide a concise, structured explanation of what was changed, scanned, or implemented and why.
=== END PROJECT CONTEXT ===\n\n`;

    const totalCharacters = promptText.length;
    const estimatedTokens = ContextInjector.estimateTokens(promptText);

    return {
      promptText,
      totalFiles: project.files.length,
      includedFilesCount: includedFiles.length,
      estimatedTokens,
      totalCharacters,
    };
  },

  /**
   * Converts a flat list of ProjectFiles into a nested FolderNode tree for recursive display
   */
  buildFolderTree(files: ProjectFile[]): FolderNode[] {
    const root: { [key: string]: any } = {};

    for (const file of files) {
      const parts = file.path.split('/').filter(Boolean);
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;

        if (!current[part]) {
          current[part] = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            isFolder: !isFile,
            children: isFile ? undefined : {},
            file: isFile ? file : undefined,
          };
        }
        current = current[part].children || current[part];
      }
    }

    function toArray(nodeObj: any): FolderNode[] {
      const result: FolderNode[] = [];
      for (const key of Object.keys(nodeObj)) {
        const item = nodeObj[key];
        const isFolder = item.isFolder;
        result.push({
          name: item.name,
          path: item.path,
          isFolder,
          file: item.file,
          children: isFolder && item.children ? toArray(item.children) : undefined,
        });
      }

      // Sort: folders first, then files alphabetically
      return result.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    return toArray(root);
  },

  /**
   * Detects the programming language / extension from a file path
   */
  detectLanguage(path: string): string {
    return FileSecurity.detectLanguage(path);
  },
};
