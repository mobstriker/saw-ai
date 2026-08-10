import JSZip from 'jszip';
import { Project, ProjectFile } from '../types';

export class ZipExporter {
  /**
   * Export all files of a project workspace into a cleanly structured .zip archive
   */
  public static async exportProjectAsZip(project: Project): Promise<void> {
    if (!project.files || project.files.length === 0) {
      alert(`Project "${project.name}" does not have any files to download yet.`);
      return;
    }

    const zip = new JSZip();

    // 1. Add all project files with their paths
    project.files.forEach((file) => {
      // Normalize path to prevent leading slashes
      const cleanPath = file.path.replace(/^\/+/, '');
      zip.file(cleanPath, file.content);
    });

    // 2. Add Project Instructions as a system prompt / README if specified
    if (project.instructions) {
      zip.file(
        'PROJECT_INSTRUCTIONS.md',
        `# Project Instructions & AI Context\n\n**Project:** ${project.name}\n**Description:** ${
          project.description || 'N/A'
        }\n\n## Instructions\n${project.instructions}\n`
      );
    }

    // 3. Generate binary zip blob
    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6,
      },
    });

    // 4. Trigger download
    const cleanProjectName = project.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    const filename = `${cleanProjectName || 'workspace'}_files.zip`;

    this.downloadBlob(content, filename);
  }

  /**
   * Export an arbitrary array of files as a zip archive
   */
  public static async exportFilesAsZip(
    files: ProjectFile[],
    archiveName: string = 'workspace_files'
  ): Promise<void> {
    if (!files || files.length === 0) {
      alert('No files available to download.');
      return;
    }

    const zip = new JSZip();
    files.forEach((file) => {
      const cleanPath = file.path.replace(/^\/+/, '');
      zip.file(cleanPath, file.content);
    });

    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const cleanArchiveName = archiveName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    this.downloadBlob(content, `${cleanArchiveName}.zip`);
  }

  /**
   * Utility helper to trigger client-side download
   */
  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
