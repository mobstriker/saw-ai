import React, { useState, useEffect } from 'react';
import {
  X,
  FilePlus2,
  Folder,
  Code2,
  Check,
  FileCode,
  FileJson,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';
import { Project, ProjectFile } from '../types';
import { ContextInjector } from '../utils/contextInjector';

interface CreateFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  initialFolder?: string;
  onCreateFile: (file: ProjectFile) => void;
}

const TEMPLATES: Record<string, { label: string; ext: string; content: string; lang: string }> = {
  blank: {
    label: 'Empty File',
    ext: '.txt',
    lang: 'text',
    content: '',
  },
  python: {
    label: 'Python Script (.py)',
    ext: '.py',
    lang: 'python',
    content: `"""
Module docstring: Pure context Python utility
"""
import sys
import os

def main():
    print("Executing Python module in SAW AI")

if __name__ == "__main__":
    main()
`,
  },
  tsx: {
    label: 'React Component (.tsx)',
    ext: '.tsx',
    lang: 'tsx',
    content: `import React, { useState } from 'react';

export default function CustomComponent() {
  const [active, setActive] = useState(true);

  return (
    <div className="p-4 rounded-xl bg-white border border-[#E6DFD3] font-sans">
      <h3 className="text-sm font-bold text-[#2C2825]">Custom Component</h3>
      <p className="text-xs text-[#7C756E] mt-1">Generated in SAW AI.</p>
    </div>
  );
}
`,
  },
  env: {
    label: 'Environment Variables (.env)',
    ext: '.env',
    lang: 'env',
    content: `# SAW AI Environment Variables
API_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o
DATABASE_URL=postgresql://localhost:5432/workspace
DEBUG=true
`,
  },
  json: {
    label: 'JSON Configuration (.json)',
    ext: '.json',
    lang: 'json',
    content: `{
  "name": "byok-workspace-config",
  "version": "1.0.0",
  "pureContextRetention": true,
  "zeroChunkingLoss": true,
  "settings": {
    "theme": "warm-organic",
    "retention": "100%"
  }
}
`,
  },
  markdown: {
    label: 'Markdown Doc (.md)',
    ext: '.md',
    lang: 'markdown',
    content: `# Project Documentation

## Architecture Overview
This workspace holds all files in pure unchunked UTF-8 memory and injects 100% full context into the LLM system prompt.

### Modules
- Source code in \`src/\`
- Python backend in \`lib/\`
- Configuration in \`.env\`
`,
  },
  css: {
    label: 'CSS Stylesheet (.css)',
    ext: '.css',
    lang: 'css',
    content: `/* Workspace Custom Stylesheet */
.custom-workspace-layer {
  background-color: #FAF8F5;
  color: #2C2825;
  border: 1px solid #E6DFD3;
}
`,
  },
  sql: {
    label: 'SQL Migration (.sql)',
    ext: '.sql',
    lang: 'sql',
    content: `-- SQL Schema Definition
CREATE TABLE IF NOT EXISTS workspace_artifacts (
  id VARCHAR(64) PRIMARY KEY,
  file_path VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  size_bytes INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
  },
};

export const CreateFileModal: React.FC<CreateFileModalProps> = ({
  isOpen,
  onClose,
  project,
  initialFolder = '',
  onCreateFile,
}) => {
  const [fileName, setFileName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState(initialFolder);
  const [isCustomFolder, setIsCustomFolder] = useState(false);
  const [customFolderPath, setCustomFolderPath] = useState('');
  const [templateKey, setTemplateKey] = useState('blank');
  const [fileContent, setFileContent] = useState('');
  const [includeInPrompt, setIncludeInPrompt] = useState(true);

  // Extract all unique existing folder paths from project files
  const existingFolders = React.useMemo(() => {
    const folderSet = new Set<string>();
    folderSet.add(''); // Root folder

    project.files.forEach((f) => {
      const parts = f.path.split('/');
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
          folderSet.add(parts.slice(0, i).join('/'));
        }
      }
    });

    return Array.from(folderSet).sort();
  }, [project.files]);

  useEffect(() => {
    if (initialFolder) {
      setSelectedFolder(initialFolder);
    }
  }, [initialFolder, isOpen]);

  if (!isOpen) return null;

  const handleTemplateChange = (key: string) => {
    setTemplateKey(key);
    const tmpl = TEMPLATES[key];
    if (tmpl) {
      setFileContent(tmpl.content);
      if (!fileName || fileName.startsWith('untitled') || fileName.includes('.')) {
        const baseName = fileName ? fileName.split('.')[0] : 'new_file';
        setFileName(`${baseName}${tmpl.ext}`);
      }
    }
  };

  const finalFolderPath = isCustomFolder
    ? customFolderPath.trim().replace(/^\/+|\/+$/g, '')
    : selectedFolder.trim().replace(/^\/+|\/+$/g, '');

  const cleanFileName = fileName.trim().replace(/^\/+/, '');
  const finalPath = finalFolderPath ? `${finalFolderPath}/${cleanFileName}` : cleanFileName;
  const detectedLang = ContextInjector.detectLanguage(cleanFileName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanFileName) return;

    const newFile: ProjectFile = {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanFileName.split('/').pop() || cleanFileName,
      path: finalPath,
      content: fileContent,
      size: new Blob([fileContent]).size,
      includedInContext: includeInPrompt,
      language: detectedLang,
      lastModified: Date.now(),
    };

    onCreateFile(newFile);
    onClose();
    // Reset state
    setFileName('');
    setFileContent('');
    setTemplateKey('blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans text-[#2C2825]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-xs">
              <FilePlus2 size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2C2825]">Create New File</h3>
              <p className="text-[11px] text-[#7C756E]">
                Add any file (.py, .tsx, .env, .json, .sql) directly into project context
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Quick Starter Templates */}
          <div>
            <label className="block text-xs font-bold text-[#7C756E] uppercase tracking-wider mb-2">
              Starter Template
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(TEMPLATES).map(([key, t]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleTemplateChange(key)}
                  className={`px-3 py-2 rounded-xl text-left border text-xs transition-all cursor-pointer ${
                    templateKey === key
                      ? 'bg-[#FAF8F5] border-[#C58B51] text-[#C58B51] font-bold shadow-2xs'
                      : 'bg-white border-[#E6DFD3] text-[#7C756E] hover:text-[#2C2825] hover:border-[#C58B51]'
                  }`}
                >
                  <div className="truncate">{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Target Folder Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">Target Folder</label>
              {!isCustomFolder ? (
                <div className="space-y-1.5">
                  <select
                    value={selectedFolder}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setIsCustomFolder(true);
                      } else {
                        setSelectedFolder(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-medium cursor-pointer"
                  >
                    {existingFolders.map((f) => (
                      <option key={f} value={f}>
                        {f === '' ? '/ (Project Root)' : `📁 ${f}`}
                      </option>
                    ))}
                    <option value="__custom__">+ Create New Folder Path...</option>
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customFolderPath}
                    onChange={(e) => setCustomFolderPath(e.target.value)}
                    placeholder="e.g. src/lib or api/v1"
                    className="flex-1 px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setIsCustomFolder(false)}
                    className="px-2.5 py-2 text-xs font-semibold rounded-xl bg-white border border-[#E6DFD3] text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* File Name input */}
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">
                File Name & Extension
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="e.g. utils.py, Navbar.tsx, .env, schema.sql"
                className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono font-medium"
                required
              />
            </div>
          </div>

          {/* Full Path Preview */}
          {cleanFileName && (
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[#7C756E] font-medium">Full Path:</span>
                <span className="font-mono font-bold text-[#C58B51]">{finalPath}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#E6DFD3] font-mono text-[#7C756E] uppercase">
                  {detectedLang}
                </span>
              </div>
            </div>
          )}

          {/* File Content Editor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-[#2C2825]">File Content</label>
              <span className="text-[10px] text-[#7C756E]">
                {fileContent.split('\n').length} lines · {fileContent.length} chars
              </span>
            </div>
            <textarea
              rows={8}
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              placeholder="// Paste or write initial code here..."
              className="w-full p-3 rounded-xl text-xs font-mono bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none leading-relaxed"
            />
          </div>

          {/* In-Prompt Context Checkbox */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-[#E6DFD3] bg-white">
            <div>
              <div className="text-xs font-bold text-[#2C2825]">Inject in LLM Prompt Context</div>
              <div className="text-[11px] text-[#7C756E]">
                100% full-file retention without vector chunking loss
              </div>
            </div>
            <input
              type="checkbox"
              checked={includeInPrompt}
              onChange={(e) => setIncludeInPrompt(e.target.checked)}
              className="w-4 h-4 accent-[#C58B51] cursor-pointer"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6DFD3]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#E6DFD3] bg-white text-xs font-bold text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!cleanFileName}
              className="px-5 py-2 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-xs font-bold text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>Create File</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
