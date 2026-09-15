import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  publicDir: '../static',
  build: { outDir: '../dist', emptyOutDir: true },
  worker: { format: 'es' },
});
