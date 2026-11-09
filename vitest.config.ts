import { defineConfig } from 'vitest/config';

// Two projects (see CONTRIBUTING.md). A test file goes to `logic` when it is a plain `*.test.ts`:
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

// Worker ceiling. In Vitest 4 `maxWorkers` is one limit for all projects that run at the same time: the projects share
// one worker queue. Projects with different `maxWorkers` need different `sequence.groupOrder` and then run one after
// the other, so a split of 2 + 4 is not possible without a slower run. Plain `npm test` uses a total of 6 workers.
// An explicit `--maxWorkers=N` on the command line is a total of N (it was N for each pool in Vitest 3).
const workerFlag = process.argv.some((arg) => arg.startsWith('--maxWorkers') || arg.startsWith('--max-workers'));

export default defineConfig({
  test: {
    globals: false,
    maxWorkers: workerFlag ? undefined : 6,
    css: false,
    // @grafana/* ESM builds import extensionless @rc-component files. moment and moment-timezone stay external: inlined,
    // the ESM moment and the moment that moment-timezone requires are two instances, and `moment().tz` is missing.
    server: { deps: { inline: [/@rc-component/, /@grafana\//] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'logic',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.logic.ts'],
          include: ['src/**/*.test.ts'],
          exclude: [...exclude, ...componentTests],
          pool: 'threads',
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
          pool: 'forks',
        },
      },
    ],
  },
});
