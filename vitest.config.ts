import { defineConfig } from 'vitest/config';

// Two projects (see README, Development). A test file goes to `logic` when it is a plain `*.test.ts`:
// no render, no vi.mock and no @grafana/ui. Every other file goes to `components`.
// `logic` shares one jsdom document per worker (isolate: false): it skips the per-file import of @grafana/data.
const componentTests = ['src/**/*.test.tsx', 'src/module.test.ts', 'src/query/grafana.test.ts'];
const exclude = ['node_modules', 'dist', 'tests'];

export default defineConfig({
  test: {
    globals: false,
    css: false,
    // @grafana/* ESM builds import CJS moment-timezone and extensionless @rc-component files.
    server: { deps: { inline: [/@rc-component/, /@grafana\//, /moment/] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'logic',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.logic.ts'],
          include: ['src/**/*.test.ts'],
          exclude: [...exclude, ...componentTests],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: componentTests,
          exclude,
        },
      },
    ],
  },
});
