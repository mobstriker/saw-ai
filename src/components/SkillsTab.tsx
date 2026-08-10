import React, { useState, useRef } from 'react';
import {
  Sparkles,
  Plus,
  Folder,
  FileCode,
  FileText,
  Trash2,
  Edit2,
  Download,
  Upload,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Layers,
  Terminal,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { Skill, SkillFile } from '../types';
import { FileSecurity } from '../utils/fileSecurity';

interface SkillsTabProps {
  skills: Skill[];
  onUpdateSkills: (skills: Skill[]) => void;
  onOpenAddModal: (skillToEdit?: Skill | null) => void;
}

export const SkillsTab: React.FC<SkillsTabProps> = ({
  skills,
  onUpdateSkills,
  onOpenAddModal,
}) => {
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(skills[0]?.id || null);
  const [activeFileTab, setActiveFileTab] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.folderName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSkillEnabled = (skillId: string) => {
    const updated = skills.map((s) =>
      s.id === skillId ? { ...s, enabledByDefault: !s.enabledByDefault } : s
    );
    onUpdateSkills(updated);
  };

  const handleDeleteSkill = (skillId: string) => {
    if (confirm('Are you sure you want to remove this skill from the workspace?')) {
      const updated = skills.filter((s) => s.id !== skillId);
      onUpdateSkills(updated);
    }
  };

  const handleDuplicateSkill = (skill: Skill) => {
    const duplicated: Skill = {
      ...skill,
      id: `skill-${Date.now()}`,
      name: `${skill.name} (Copy)`,
      folderName: `${skill.folderName || 'skill'}-copy`,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onUpdateSkills([...skills, duplicated]);
    setExpandedSkillId(duplicated.id);
  };

  const handleExportSkill = (skill: Skill) => {
    const blob = new Blob([JSON.stringify(skill, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skill-${skill.folderName || skill.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSkillFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const skillFiles: SkillFile[] = [];
    let detectedName = 'Imported Skill';
    let detectedDescription = 'Imported from local skill folder.';
    let detectedFolder = 'imported-skill';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = (file as any).webkitRelativePath
        ? (file as any).webkitRelativePath.split('/').slice(1).join('/')
        : file.name;

      const path = relPath || file.name;
      const fileName = path.split('/').pop() || path;

      if (i === 0 && (file as any).webkitRelativePath) {
        const rootFolder = (file as any).webkitRelativePath.split('/')[0];
        if (rootFolder) {
          detectedFolder = rootFolder;
          detectedName = rootFolder
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        }
      }

      const readResult = await FileSecurity.readFileSafely(file, path);
      if (!readResult.allowed) {
        console.warn(`Skipping unsafe skill file: ${fileName} (${readResult.reason})`);
        continue;
      }

      skillFiles.push({
        path,
        name: fileName,
        content: readResult.content,
        language: readResult.language,
      });

      if (fileName.toLowerCase() === 'skill.md') {
        const matchName = readResult.content.match(/name:\s*([^\n\r]+)/i);
        const matchDesc = readResult.content.match(/description:\s*([^\n\r]+)/i);
        if (matchName) detectedName = matchName[1].trim();
        if (matchDesc) detectedDescription = matchDesc[1].trim();
      }
    }

    if (skillFiles.length > 0) {
      const hasSkillMd = skillFiles.some((f) => f.name.toLowerCase() === 'skill.md');
      if (!hasSkillMd) {
        skillFiles.unshift({
          path: 'SKILL.md',
          name: 'SKILL.md',
          language: 'markdown',
          content: `# ${detectedName}\n\n${detectedDescription}`,
        });
      }

      const importedSkill: Skill = {
        id: `skill-${Date.now()}`,
        name: detectedName,
        folderName: detectedFolder,
        description: detectedDescription,
        triggerConditions: 'When executing tasks matching this skill.',
        enabledByDefault: true,
        author: 'Local Import',
        version: '1.0.0',
        files: skillFiles,
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      onUpdateSkills([...skills, importedSkill]);
      setExpandedSkillId(importedSkill.id);
      setImportStatus(`Imported "${detectedName}" with ${skillFiles.length} file(s)!`);
      setTimeout(() => setImportStatus(null), 3500);
    }
  };

  return (
    <div className="space-y-6">
      {/* Informational Header */}
      <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} className="text-[#C58B51]" />
            <h4 className="text-xs font-bold text-[#2C2825]">Agent Skills & Modular Instruction Bundles</h4>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F5F1EA] text-[#C58B51] font-bold border border-[#E6DFD3]">
            {skills.length} Installed
          </span>
        </div>
        <p className="text-xs text-[#7C756E] leading-relaxed">
          Skills are specialized instruction bundles structured around a <code className="font-mono text-[#C58B51]">SKILL.md</code> specification and companion Python/TypeScript scripts and templates. They can be toggled per-chat or activated dynamically by the AI.
        </p>
      </div>

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter skills by name or keyword..."
          className="px-3.5 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none flex-1"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="px-3.5 py-2 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-bold text-[#2C2825] shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
          >
            <Folder size={14} className="text-[#C58B51]" />
            <span>Upload Folder</span>
          </button>

          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={handleImportSkillFolder}
          />

          <button
            type="button"
            onClick={() => onOpenAddModal(null)}
            className="px-4 py-2 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-xs font-bold text-white shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
          >
            <Plus size={14} />
            <span>Add Skill</span>
          </button>
        </div>
      </div>

      {importStatus && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span>{importStatus}</span>
        </div>
      )}

      {/* Skills List */}
      <div className="space-y-3">
        {filteredSkills.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-[#E6DFD3] bg-[#FAF8F5]">
            <Sparkles size={28} className="text-[#A09890] mx-auto mb-2" />
            <div className="text-xs font-bold text-[#2C2825]">No Skills Found</div>
            <p className="text-[11px] text-[#7C756E] mt-0.5">
              Click &quot;Add Skill&quot; or upload a skill folder containing SKILL.md.
            </p>
          </div>
        ) : (
          filteredSkills.map((skill) => {
            const isExpanded = expandedSkillId === skill.id;
            const fileIdx = activeFileTab[skill.id] || 0;
            const currentFile = skill.files[fileIdx] || skill.files[0];
            const scriptCount = skill.files.filter((f) => !f.name.toLowerCase().includes('skill.md')).length;

            return (
              <div
                key={skill.id}
                className={`rounded-2xl border transition-all overflow-hidden bg-white ${
                  isExpanded ? 'border-[#C58B51] shadow-sm' : 'border-[#E6DFD3] hover:border-[#D9CFBF]'
                }`}
              >
                {/* Skill Summary Header Row */}
                <div
                  onClick={() => setExpandedSkillId(isExpanded ? null : skill.id)}
                  className="p-4 flex items-center justify-between gap-4 cursor-pointer bg-[#FAF8F5] hover:bg-[#F5F1EA]/70 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-white border border-[#E6DFD3] text-[#C58B51] flex items-center justify-center font-bold shadow-2xs shrink-0">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#2C2825]">{skill.name}</span>
                        {skill.folderName && (
                          <span className="text-[10px] font-mono px-2 py-0.2 rounded-md bg-white border border-[#E6DFD3] text-[#7C756E]">
                            /{skill.folderName}
                          </span>
                        )}
                        {skill.isBuiltIn && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            Verified
                          </span>
                        )}
                        <span className="text-[10px] text-[#A09890] font-medium">
                          {skill.files.length} file{skill.files.length !== 1 ? 's' : ''}
                          {scriptCount > 0 && ` (${scriptCount} companion script${scriptCount !== 1 ? 's' : ''})`}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#7C756E] truncate max-w-xl mt-0.5">
                        {skill.description}
                      </p>
                    </div>
                  </div>

                  {/* Right Actions & Toggle */}
                  <div
                    className="flex items-center gap-3 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-[#7C756E] hidden sm:inline">
                        Default Active:
                      </span>
                      <input
                        type="checkbox"
                        checked={skill.enabledByDefault ?? true}
                        onChange={() => toggleSkillEnabled(skill.id)}
                        className="w-4 h-4 accent-[#C58B51] cursor-pointer"
                        title="Toggle whether skill is enabled by default in new conversations"
                      />
                    </div>

                    <div className="flex items-center gap-1 border-l border-[#E6DFD3] pl-3">
                      <button
                        type="button"
                        onClick={() => onOpenAddModal(skill)}
                        className="p-1.5 rounded-lg text-[#7C756E] hover:text-[#2C2825] hover:bg-white transition-colors cursor-pointer"
                        title="Edit Skill Files & Instructions"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateSkill(skill)}
                        className="p-1.5 rounded-lg text-[#7C756E] hover:text-[#2C2825] hover:bg-white transition-colors cursor-pointer"
                        title="Duplicate Skill"
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportSkill(skill)}
                        className="p-1.5 rounded-lg text-[#7C756E] hover:text-[#2C2825] hover:bg-white transition-colors cursor-pointer"
                        title="Export Skill as JSON"
                      >
                        <Download size={13} />
                      </button>
                      {!skill.isBuiltIn && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSkill(skill.id)}
                          className="p-1.5 rounded-lg text-[#7C756E] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          title="Delete Skill"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Skill Inspector: Files & Content Preview */}
                {isExpanded && (
                  <div className="p-4 border-t border-[#E6DFD3] bg-white space-y-4 animate-in fade-in">
                    {/* Trigger Conditions */}
                    {skill.triggerConditions && (
                      <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-start gap-2">
                        <Info size={14} className="text-[#C58B51] shrink-0 mt-0.5" />
                        <div>
                          <div className="text-[11px] font-bold text-[#2C2825]">
                            Activation Triggers & Rules:
                          </div>
                          <div className="text-xs text-[#7C756E] mt-0.5">
                            {skill.triggerConditions}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Files Tabs */}
                    <div className="rounded-xl border border-[#E6DFD3] overflow-hidden bg-[#FAF8F5]">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-[#E6DFD3] bg-white overflow-x-auto">
                        <div className="flex items-center gap-1">
                          {skill.files.map((f, idx) => {
                            const isSelected = idx === fileIdx;
                            const isMd = f.name.endsWith('.md');
                            const isPy = f.name.endsWith('.py');
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() =>
                                  setActiveFileTab((prev) => ({ ...prev, [skill.id]: idx }))
                                }
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                                  isSelected
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
                                <span>{f.path}</span>
                              </button>
                            );
                          })}
                        </div>

                        <span className="text-[10px] text-[#A09890] font-mono">
                          {currentFile?.content.length || 0} characters
                        </span>
                      </div>

                      {/* File Content Preview */}
                      <pre className="p-4 text-xs font-mono text-[#2C2825] overflow-x-auto max-h-64 leading-relaxed whitespace-pre-wrap select-text bg-[#FAF8F5]">
                        {currentFile?.content}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
