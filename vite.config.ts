import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      // Split the ~1MB bundle into cacheable vendor chunks so the main thread
      // spends less time parsing/evaluating JS on startup (important on slower
      // CPUs). Vendor code changes rarely, so it stays cached across releases.
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'markdown-vendor': ['katex'],
            'tauri-vendor': ['@tauri-apps/api', '@tauri-apps/plugin-fs', '@tauri-apps/plugin-http'],
            // gpt-tokenizer ships large BPE tables; isolate it so it loads
            // lazily and never bloats the app entry chunk.
            'tokenizer-vendor': ['gpt-tokenizer'],
            // motion and dexie/jszip share transitive imports; grouping them
            // avoids a circular-chunk warning and keeps both out of the app chunk.
            'data-vendor': ['dexie', 'dexie-react-hooks', 'jszip', 'motion', 'lucide-react'],
            // Sandpack pulls in a large bundler UI; isolate so it loads lazily
            // only when a TSX/JSX preview is opened.
            'sandpack-vendor': ['@codesandbox/sandpack-react'],
          },
        },
      },
      // Suppress the size warning for the app chunk; it is expected because the
      // app itself is large. Code-splitting above still reduces per-chunk cost.
      chunkSizeWarningLimit: 1100,
    },
  };
});
