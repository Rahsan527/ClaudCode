import { defineConfig } from 'vite';

export default defineConfig({
  // Three.js сам по себе ~600 КБ — это нормально для игры
  build: { chunkSizeWarningLimit: 1000 },
});
