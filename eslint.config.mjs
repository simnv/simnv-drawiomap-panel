import { defineConfig } from 'eslint/config';
import { fixupPluginRules } from '@eslint/compat';
import baseConfig from './.config/eslint.config.mjs';

// eslint-plugin-react 7.37 still calls context.getFilename() and other APIs that ESLint 10 removed.
// fixupPluginRules adds them back. Every config object that carries the plugin gets the wrapped copy.
const wrapReact = (config) =>
  config.plugins?.react
    ? { ...config, plugins: { ...config.plugins, react: fixupPluginRules(config.plugins.react) } }
    : config;

export default defineConfig([
  {
    ignores: [
      '**/logs',
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/.pnpm-debug.log*',
      '**/node_modules/',
      '.yarn/cache',
      '.yarn/unplugged',
      '.yarn/build-state.yml',
      '.yarn/install-state.gz',
      '**/.pnp.*',
      '**/pids',
      '**/*.pid',
      '**/*.seed',
      '**/*.pid.lock',
      '**/lib-cov',
      '**/coverage',
      '**/dist/',
      '**/artifacts/',
      '**/work/',
      '**/ci/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'playwright/.cache/',
      'playwright/.auth/',
      '**/.idea',
      '**/.eslintcache',
      '.drawio/',
      // Agent worktrees: other checkouts of this repository, each linted on its own.
      '.claude/worktrees/',
      // Managed by create-plugin. ESLint 10 reads the config nearest to each file, so these files would use
      // .config/eslint.config.mjs, which has no React plugin wrapper.
      '.config/',
    ],
  },
  ...baseConfig.map(wrapReact),
]);
