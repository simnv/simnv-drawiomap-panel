import { defineConfig } from 'vitest/config';

// Two projects (see README, Development). A test file goes to `logic` when it is a plain `*.test.ts`:
// no render, no vi.mock and no @grafana/ui. Every other file goes to `components`.
// `logic` shares one jsdom document per worker (isolate: false): it skips the per-file import of @grafana/data.
const componentTests = [
  'src/**/*.test.tsx',
  // These .ts files mock modules.
  'src/module.test.ts',
  'src/query/grafana.test.ts',
  // These .ts files reach DOMPurify, which binds to the jsdom window of the first file that imports it.
  // vitest.setup.logic.ts mocks dompurify with an error, so a logic file that reaches it fails every time.
  'src/adapter/portograph.test.ts',
  'src/editor/setCellAttrs.test.ts',
  'src/harness.test.ts',
  'src/render/applier.test.ts',
  'src/render/sanitize.test.ts',
  'src/render/sanitizeCache.test.ts',
  'src/render/svgStage.test.ts',
];
const exclude = ['node_modules', 'dist', 'tests'];

export default defineConfig({
  test: {
    globals: false,
    css: false,
    // Only the logic project uses threads. Vitest reads this pool option from the root, not from a project.
    poolOptions: { threads: { isolate: false } },
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
          // Threads, because the pool reads the isolate flag of the root config only: see poolOptions above.
          pool: 'threads',
          isolate: false,
          poolOptions: { threads: { isolate: false } },
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
