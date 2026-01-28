import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export default defineConfig({
  // Use relative paths so the built app can be hosted from any subpath
  // (and opened from the filesystem) without needing to live at the domain root.
  base: './',

  build: {
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new URL('.', import.meta.url)), 'index.html'),
        flatmap: resolve(fileURLToPath(new URL('.', import.meta.url)), 'flatmap.html'),
        winkel: resolve(fileURLToPath(new URL('.', import.meta.url)), 'winkel.html'),
      },
    },
  },
});
