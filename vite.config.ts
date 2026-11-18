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
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // The ML datasets can contain 10,000+ files and are not frontend dependencies.
        // Keep React HMR active while ignoring non-frontend project trees.
        ignored: [
          '**/dataset/**',
          '**/datasets/**',
          '**/.feature_cache/**',
          '**/ml/**',
          '**/backend/**',
          '**/tests/**',
          '**/.venv/**',
          '**/__pycache__/**',
          '**/.pytest_cache/**',
          '**/resources/**',
          '**/backup_*/**',
          '**/_premium_ui_recovery_backup_*/**',
        ],
      },
      proxy: {
        '/auth': 'http://127.0.0.1:8000',
        '/instructor': 'http://127.0.0.1:8000',
        '/lobbies': 'http://127.0.0.1:8000',
        '/lobby': 'http://127.0.0.1:8000',
        '/public': 'http://127.0.0.1:8000',
        '/health': 'http://127.0.0.1:8000',
        // Local WebSocket events need an explicit upgrade proxy.
        '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
      },
    },
  };
});
