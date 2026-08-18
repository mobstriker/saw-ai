import React, { useState, useRef } from 'react';
import {
  X,
  Sparkles,
  Folder,
  FileCode,
  FileText,
  Plus,
  Trash2,
  Upload,
  Check,
  Code2,
  Info,
  Terminal,
  BookOpen,
} from 'lucide-react';
import { Skill, SkillFile } from '../types';
import { FileSecurity } from '../utils/fileSecurity';
import { extractZipFiles, isZipFileExport } from '../utils/zipImporter';
import { collectDroppedFiles } from '../utils/dropHandler';

interface AddSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSkill: (skill: Skill) => void;
  initialSkill?: Skill | null;
}

export const AddSkillModal: React.FC<AddSkillModalProps> = ({
  isOpen,
  onClose,
  onSaveSkill,
  initialSkill,
}) => {
  const isEditing = Boolean(initialSkill);

  const [name, setName] = useState(initialSkill?.name || '');
  const [folderName, setFolderName] = useState(
    initialSkill?.folderName || (initialSkill?.name ? initialSkill.name.toLowerCase().replace(/\s+/g, '-') : '')
  );
  const [description, setDescription] = useState(initialSkill?.description || '');
  const [triggerConditions, setTriggerConditions] = useState(initialSkill?.triggerConditions || '');
  const [enabledByDefault, setEnabledByDefault] = useState(initialSkill?.enabledByDefault ?? true);
  const [author, setAuthor] = useState(initialSkill?.author || 'User Workspace');
  const [version, setVersion] = useState(initialSkill?.version || '1.0.0');

  const defaultStarterFiles: SkillFile[] = [
    {
      path: 'SKILL.md',
      name: 'SKILL.md',
      language: 'markdown',
      content: `---
name: ${name || 'my-custom-skill'}
description: ${description || 'Detailed instructions for this specialized agent skill.'}
triggers:
  - Specific prompt keyword or condition
---

# Skill Instructions

## 1. Objectives & Behavior
- State the specific goal of this skill and what the AI should execute.
- Define formatting rules, architecture conventions, and prohibited patterns.

## 2. Step-by-Step Workflow
1. Analyze the context and user request.
2. Execute the task following the helper scripts or templates provided.
`,
    },
  ];

  const [files, setFiles] = useState<SkillFile[]>(initialSkill?.files || defaultStarterFiles);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [newFilePath, setNewFilePath] = useState('');
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const currentFile = files[activeFileIndex] || files[0];

  const handleContentChange = (newContent: string) => {
    setFiles((prev) =>
      prev.map((f, idx) => (idx === activeFileIndex ? { ...f, content: newContent } : f))
    );
  };

  const handleAddNewFile = () => {
    if (!newFilePath.trim()) return;
    const cleanPath = newFilePath.trim().replace(/^\/+/, '');
    const fileName = cleanPath.split('/').pop() || cleanPath;
    const ext = fileName.split('.').pop()?.toLowerCase() || 'text';

    const newFile: SkillFile = {
      path: cleanPath,
      name: fileName,
      language: ext === 'py' ? 'python' : ext === 'ts' ? 'typescript' : ext === 'js' ? 'javascript' : ext === 'json' ? 'json' : 'markdown',
      content: ext === 'py' ? '"""\nHelper Python Script for this Skill\n"""\n\ndef run_task():\n    pass\n' : '# Template content\n',
    };

    setFiles((prev) => [...prev, newFile]);
    setActiveFileIndex(files.length);
    setNewFilePath('');
    setIsAddingFile(false);
  };

  const handleDeleteFile = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (files.length <= 1) {
      alert('A skill must have at least one file (SKILL.md).');
      return;
    }
    const filtered = files.filter((_, i) => i !== idx);
    setFiles(filtered);
    if (activeFileIndex >= filtered.length) {
      setActiveFileIndex(filtered.length - 1);
    }
  };

  // Folder & File Upload parser (drag-and-drop or webkitdirectory input).
  // Handles loose files, whole folders (webkitdirectory), AND .zip archives
  // (e.g. a downloaded skill from GitHub). Zips are extracted in-browser so
  // every file inside — SKILL.md, Python/TS helpers, templates — is imported.
  const handleUploadedFilesList = async (uploadedFileList: FileList | File[]) => {
    const newFilesList: SkillFile[] = [];
    let detectedSkillName = name;
    let detectedDescription = description;

    // First pass: expand any .zip into its constituent files. This lets the
    // user drop a single downloaded zip and still get the full skill bundle.
    const expandedFiles: File[] = [];
    for (let i = 0; i < uploadedFileList.length; i++) {
      const f = uploadedFileList[i];
      if (isZipFileExport(f)) {
        const result = await extractZipFiles(f);
        if (result.error) {
          console.warn(result.error);
          setUploadNotice(`Could not read "${f.name}".`);
          setTimeout(() => setUploadNotice(null), 3000);
          continue;
        }
        // Project each extracted entry into a lightweight File-like object the
        // shared read loop below already understands (webkitRelativePath
        // preserves the in-archive folder structure).
        for (const ef of result.files) {
          const fake = new File([ef.content], ef.name, { type: 'text/plain' });
          Object.defineProperty(fake, 'webkitRelativePath', {
            value: f.name.replace(/\.zip$/i, '') + '/' + ef.path,
            configurable: true,
          });
          expandedFiles.push(fake);
        }
        if (result.skipped.length > 0) {
          console.warn(`Skipped inside ${f.name}:`, result.skipped);
        }
      } else {
        expandedFiles.push(f);
      }
    }

    for (let i = 0; i < expandedFiles.length; i++) {
      const file = expandedFiles[i];
      // Get relative path if available from webkitRelativePath
      const relPath = (file as any).webkitRelativePath
        ? (file as any).webkitRelativePath.split('/').slice(1).join('/')
        : file.name;

      const path = relPath || file.name;
      const fileName = path.split('/').pop() || path;

      const readResult = await FileSecurity.readFileSafely(file, path);
      if (!readResult.allowed) {
        console.warn(`Skipping unsafe skill file: ${fileName} (${readResult.reason})`);
        continue;
      }

      newFilesList.push({
        path,
        name: fileName,
        content: readResult.content,
        language: readResult.language,
      });

      // If SKILL.md is detected, parse frontmatter for name and description
      if (fileName.toLowerCase() === 'skill.md') {
        const matchName = readResult.content.match(/name:\s*([^\n\r]+)/i);
        const matchDesc = readResult.content.match(/description:\s*([^\n\r]+)/i);
        if (matchName && !detectedSkillName) detectedSkillName = matchName[1].trim();
        if (matchDesc && !detectedDescription) detectedDescription = matchDesc[1].trim();
      }
    }

    if (newFilesList.length > 0) {
      // Ensure SKILL.md is present; if not, create one
      const hasSkillMd = newFilesList.some((f) => f.name.toLowerCase() === 'skill.md');
      if (!hasSkillMd) {
        newFilesList.unshift({
          path: 'SKILL.md',
          name: 'SKILL.md',
          language: 'markdown',
          content: `# ${detectedSkillName || 'Imported Skill'}\n\n${detectedDescription || 'Specialized skill instructions.'}`,
        });
      }

      setFiles(newFilesList);
      setActiveFileIndex(0);
      if (detectedSkillName) {
        setName(detectedSkillName);
        setFolderName(detectedSkillName.toLowerCase().replace(/\s+/g, '-'));
      }
      if (detectedDescription) setDescription(detectedDescription);

      setUploadNotice(`Loaded ${newFilesList.length} file(s)${newFilesList.length > 1 ? ' (including extracted zip contents)' : ''}!`);
      setTimeout(() => setUploadNotice(null), 3000);
    }
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert('Please provide a name for the skill.');
      return;
    }

    // Ensure SKILL.md exists
    let finalFiles = [...files];
    const hasSkillMd = finalFiles.some((f) => f.name.toLowerCase() === 'skill.md');
    if (!hasSkillMd) {
      finalFiles.unshift({
        path: 'SKILL.md',
        name: 'SKILL.md',
        language: 'markdown',
        content: `---
name: ${name}
description: ${description}
---

# ${name} Instructions
${triggerConditions ? `Trigger: ${triggerConditions}\n` : ''}
`,
      });
    }

    const newSkill: Skill = {
      id: initialSkill?.id || `skill-${Date.now()}`,
      name: name.trim(),
      folderName: folderName.trim() || name.toLowerCase().replace(/\s+/g, '-'),
      description: description.trim() || 'Custom user skill bundle.',
      triggerConditions: triggerConditions.trim() || 'Applied when relevant to the task.',
      enabledByDefault,
      author: author.trim() || 'User Workspace',
      version: version.trim() || '1.0.0',
      files: finalFiles,
      isBuiltIn: initialSkill?.isBuiltIn ?? false,
      createdAt: initialSkill?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    onSaveSkill(newSkill);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-4xl max-h-[92vh] bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans text-[#2C2825]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-xs">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2C2825]">
                {isEditing ? 'Edit Skill Bundle' : 'Add New Skill Folder & Instructions'}
              </h3>
              <p className="text-[11px] text-[#7C756E]">
                Modular instruction packages containing SKILL.md, python/ts helper scripts, and templates
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

        {/* Modal Body: Two Columns */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-6 bg-white">
          {/* Left Column: Metadata & Folder Upload (5 cols) */}
          <div className="md:col-span-5 space-y-4">
            {/* Quick Upload Folder Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOver(false);
                // Use the shared drop handler so dragging a whole FOLDER onto
                // this tile traverses every nested file (browsers expose folder
                // contents via DataTransferItem.getAsEntry, not via .files).
                // Each dropped file is tagged with its relative path so the
                // existing read loop picks it up. Zips are expanded inside
                // collectDroppedFiles too.
                const dropped = await collectDroppedFiles(e.dataTransfer);
                if (dropped.length > 0) {
                  const tagged: File[] = dropped.map((d) => {
                    const fake = new File([d.file], d.file.name, { type: d.file.type });
                    Object.defineProperty(fake, 'webkitRelativePath', {
                      value: d.path,
                      configurable: true,
                    });
                    return fake;
                  });
                  handleUploadedFilesList(tagged);
                }
              }}
              className={`p-4 rounded-xl border-2 border-dashed transition-all text-center flex flex-col items-center justify-center gap-2 ${
                dragOver
                  ? 'border-[#C58B51] bg-[#F5E6D3]/30'
                  : 'border-[#E6DFD3] bg-[#FAF8F5] hover:border-[#C58B51]'
              }`}
            >
              <Folder size={24} className="text-[#C58B51]" />
              <div>
                <div className="text-xs font-bold text-[#2C2825]">Upload Whole Skill Folder</div>
                <p className="text-[10px] text-[#7C756E]">
                  Drag & drop folder with SKILL.md, scripts, & templates
                </p>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="px-3 py-1 rounded-lg bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[11px] font-bold text-[#2C2825] cursor-pointer shadow-2xs"
                >
                  Select Folder
                </button>
                <button
                  type="button"
                  onClick={() => filesInputRef.current?.click()}
                  className="px-3 py-1 rounded-lg bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[11px] font-bold text-[#7C756E] hover:text-[#2C2825] cursor-pointer shadow-2xs"
                >
                  Select Files
                </button>
              </div>

              {/* Hidden file inputs */}
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleUploadedFilesList(e.target.files);
                }}
              />
              <input
                ref={filesInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleUploadedFilesList(e.target.files);
                }}
              />
            </div>

            {uploadNotice && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                <Check size={14} className="text-emerald-600 shrink-0" />
                <span>{uploadNotice}</span>
              </div>
            )}

            {/* Skill Name */}
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">
                Skill Display Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!folderName || folderName === name.toLowerCase().replace(/\s+/g, '-')) {
                    setFolderName(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                  }
                }}
                placeholder="e.g. Python Data Analyst, Doc & API Spec"
                className="w-full px-3.5 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
              />
            </div>

            {/* Folder Identifier */}
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">
                Folder Identifier (Slug)
              </label>
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="e.g. python-data-analyst"
                className="w-full px-3.5 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">
                Description & Purpose
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary of what this skill accomplishes and provides..."
                className="w-full p-2.5 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
              />
            </div>

            {/* Trigger Conditions */}
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">
                Trigger Conditions (When AI Should Use It)
              </label>
              <textarea
                rows={2}
                value={triggerConditions}
                onChange={(e) => setTriggerConditions(e.target.value)}
                placeholder="e.g. When analyzing CSV/JSON data, writing pandas scripts, or generating documentation"
                className="w-full p-2.5 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none"
              />
              <p className="text-[10px] text-[#7C756E] mt-1">
                The AI automatically references these conditions when deciding to activate the skill in conversation.
              </p>
            </div>

            {/* Enabled by default toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-[#E6DFD3] bg-[#FAF8F5]">
              <div>
                <div className="text-xs font-bold text-[#2C2825]">Enabled By Default</div>
                <div className="text-[10px] text-[#7C756E]">Auto-activate in new chat sessions</div>
              </div>
              <input
                type="checkbox"
                checked={enabledByDefault}
                onChange={(e) => setEnabledByDefault(e.target.checked)}
                className="w-4 h-4 accent-[#C58B51] cursor-pointer"
              />
            </div>
          </div>

          {/* Right Column: Files & Code Editor inside Skill (7 cols) */}
          <div className="md:col-span-7 flex flex-col border border-[#E6DFD3] rounded-xl bg-[#FAF8F5] overflow-hidden min-h-[380px]">
            {/* Files Tab Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#E6DFD3] bg-white overflow-x-auto">
              <div className="flex items-center gap-1">
                {files.map((file, idx) => {
                  const isActive = idx === activeFileIndex;
                  const isMd = file.name.endsWith('.md');
                  const isPy = file.name.endsWith('.py');
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveFileIndex(idx)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                          : 'text-[#7C756E] hover:text-[#2C2825]'
                      }`}
                    >
                      {isPy ? (
                        <FileCode size={13} className="text-blue-600" />
                      ) : isMd ? (
                        <FileText size={13} className="text-[#C58B51]" />
                      ) : (
                        <Code2 size={13} className="text-emerald-600" />
                      )}
                      <span>{file.name}</span>
                      {files.length > 1 && (
                        <span
                          onClick={(e) => handleDeleteFile(idx, e)}
                          className="ml-1 text-[#A09890] hover:text-red-600 cursor-pointer p-0.5 rounded"
                          title="Delete file"
                        >
                          <X size={11} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Add file button */}
              <button
                type="button"
                onClick={() => setIsAddingFile(!isAddingFile)}
                className="px-2 py-1 rounded-lg hover:bg-[#FAF8F5] text-xs font-bold text-[#C58B51] flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Plus size={13} />
                <span>Add File</span>
              </button>
            </div>

            {/* New File Inline Bar */}
            {isAddingFile && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[#FAF8F5] border-b border-[#E6DFD3] animate-in fade-in">
                <input
                  type="text"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddNewFile();
                    if (e.key === 'Escape') setIsAddingFile(false);
                  }}
                  placeholder="e.g. scripts/helper.py or templates/spec.md"
                  className="flex-1 px-2.5 py-1 rounded-lg text-xs bg-white border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleAddNewFile}
                  className="px-2.5 py-1 rounded-lg bg-[#C58B51] text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingFile(false)}
                  className="px-2 py-1 text-xs text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Current File Info & Editor */}
            <div className="flex-1 flex flex-col p-3 bg-white">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#7C756E]">
                  <span className="font-bold text-[#2C2825]">{currentFile?.path}</span>
                  <span>•</span>
                  <span>{currentFile?.language || 'text'}</span>
                </div>
                <span className="text-[10px] text-[#A09890]">
                  {currentFile?.content.length || 0} chars
                </span>
              </div>

              <textarea
                value={currentFile?.content || ''}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Write file content, instructions, or code..."
                className="flex-1 w-full p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono text-xs text-[#2C2825] leading-relaxed resize-none min-h-[260px]"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-2 text-xs text-[#7C756E]">
            <Sparkles size={14} className="text-[#C58B51]" />
            <span>Skills are automatically loaded and selectable in all chat threads</span>
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
              <span>{isEditing ? 'Save Changes' : 'Save Skill'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
