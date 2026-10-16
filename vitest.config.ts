import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests'],
    globals: false,
    css: false,
    // @grafana/* ESM builds import CJS moment-timezone and extensionless @rc-component files.
    server: { deps: { inline: [/@rc-component/, /@grafana\//, /moment/] } },
  },
});
