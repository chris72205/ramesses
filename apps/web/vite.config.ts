import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [tailwindcss(), svelte(), svelteTesting()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/ws': { target: backend, ws: true, changeOrigin: true },
    },
  },
  test: {
    name: 'web',
    include: ['src/**/*.spec.ts'],
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    // sv-router ships .svelte sources; inline it so the Svelte plugin compiles them in tests
    // whichever directory Vitest is started from.
    server: { deps: { inline: ['sv-router'] } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/test-setup.ts'],
    },
  },
});
