import { Artifact } from '../types';

/**
 * Extracts Claude-style artifacts from markdown code blocks
 */
export const ArtifactParser = {
  extractArtifacts(messageText: string): Artifact[] {
    if (!messageText) return [];

    const artifacts: Artifact[] = [];
    // Regex matches triple backtick code blocks with optional language and content
    const codeBlockRegex = /```([a-zA-Z0-9_\-+]*)\s*\n([\s\S]*?)```/g;

    let match: RegExpExecArray | null;
    let index = 1;

    while ((match = codeBlockRegex.exec(messageText)) !== null) {
      const lang = (match[1] || 'text').toLowerCase().trim();
      const code = match[2].trim();
      
      // Skip clarification request blocks
      if (lang === 'json' && (code.includes('"clarification_request"') || code.includes('"clarification_requests"'))) {
        continue;
      }

      // Check if code has a top-level file comment (e.g. `// FintechNavbar.tsx` or `<!-- index.html -->` or `# main.py`)
      let title = '';
      const firstLine = code.split('\n')[0].trim();
      
      const fileCommentMatch =
        firstLine.match(/^\/\/\s*([a-zA-Z0-9_.\-/]+)/i) ||
        firstLine.match(/^<!--\s*([a-zA-Z0-9_.\-/]+)\s*-->/i) ||
        firstLine.match(/^#\s*([a-zA-Z0-9_.\-/]+)/i) ||
        firstLine.match(/^\/\*\s*([a-zA-Z0-9_.\-/]+)\s*\*\//i);

      if (fileCommentMatch && fileCommentMatch[1]) {
        title = fileCommentMatch[1].trim();
      } else {
        if (lang === 'html') title = `index.html`;
        else if (lang === 'tsx' || lang === 'jsx') title = `Component${index}.tsx`;
        else if (lang === 'svg') title = `illustration${index}.svg`;
        else if (lang === 'python') title = `script${index}.py`;
        else if (lang === 'json') title = `config${index}.json`;
        else if (lang === 'css') title = `styles${index}.css`;
        else title = `Snippet ${index} (${lang.toUpperCase() || 'CODE'})`;
      }

      // Determine preview capability
      let type: 'preview' | 'code' | 'svg' | 'markdown' = 'code';
      if (['html', 'svg', 'tsx', 'jsx', 'javascript', 'js'].includes(lang)) {
        type = lang === 'svg' ? 'svg' : 'preview';
      } else if (lang === 'markdown' || lang === 'md') {
        type = 'markdown';
      }

      artifacts.push({
        id: `art-${index}-${Date.now().toString(36)}`,
        title,
        language: lang,
        code,
        type,
        version: index,
      });

      index++;
    }

    return artifacts;
  },
};
