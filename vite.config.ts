import { defineConfig } from 'vite';

export default defineConfig({
  // Use relative paths so the built app can be hosted from any subpath
  // (and opened from the filesystem) without needing to live at the domain root.
  base: './',
});
