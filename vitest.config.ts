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

// Worker ceiling. Vitest 3 applies `maxWorkers` to each pool, and the two projects run in two pools at the same time:
// the default is one worker per CPU for each pool, so plain `npm test` can start 2 x (CPUs - 1) workers. These limits
// give 6 workers in total. The components pool gets most of them: its files import @grafana/ui and cost three times
// as much as the logic files. An explicit `--maxWorkers=N` on the command line keeps its old meaning (N for each
// pool), because the pool options below would win over it.
const workerFlag = process.argv.some((arg) => arg.startsWith('--maxWorkers') || arg.startsWith('--max-workers'));
const workerLimits = workerFlag ? {} : { maxThreads: 2, maxForks: 4 };

export default defineConfig({
  test: {
    globals: false,
    css: false,
    // Only the logic project uses threads. Vitest reads this pool option from the root, not from a project.
    poolOptions: {
      threads: { isolate: false, maxThreads: workerLimits.maxThreads },
      forks: { maxForks: workerLimits.maxForks },
    },
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
