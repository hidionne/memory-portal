/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built site works from any HTTPS path (GitHub Pages, Netlify, etc.).
  base: './',
  server: { port: 5173, host: 'localhost' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
