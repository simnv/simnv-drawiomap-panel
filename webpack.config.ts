import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';
import path from 'path';
import { Compilation, sources, type Configuration, type WebpackPluginInstance } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config.ts';
import { getPackageJson } from './.config/bundler/utils.ts';
import { rewriteReadmeUrls } from './src/util/readmeUrls.ts';

/**
 * Extends the scaffolded config. See
 * https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations#extend-the-webpack-config
 *
 * Copies the vendored draw.io webapp (scripts/vendor-drawio.sh) to dist/drawio, and the shim of the bundled
 * editor (src/editor/drawio-shim.js) to dist/drawio/js/dmap-shim.js.
 * Terser must not process these files: they are already minified, or they run in the draw.io frame as they are.
 */
const DRAWIO_DIR = path.resolve(process.cwd(), '.drawio', 'webapp');
const DRAWIO_SHIM = path.resolve(process.cwd(), 'src', 'editor', 'drawio-shim.js');

/** Source modules that two lazy chunks import: the bindings popup, the YAML option editor and the option editors. */
const SHARED_EDITOR_MODULES =
  /[\\/]src[\\/](options[\\/](ConfigYamlEditor|yamlConfig|storedConfig)\.tsx?|util[\\/]hash\.ts|editor[\\/]popup[\\/]overlayStack\.ts)$/;

/** The catalogue rejects relative links in README.md. This plugin rewrites them in dist/README.md after the copy. */
const readmeUrlsPlugin: WebpackPluginInstance = {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('ReadmeUrls', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'ReadmeUrls', stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE },
        () => {
          const asset = compilation.getAsset('README.md');
          if (asset) {
            const text = asset.source.source().toString();
            compilation.updateAsset(
              'README.md',
              new sources.RawSource(rewriteReadmeUrls(text, 'simnv/simnv-drawiomap-panel', getPackageJson().version))
            );
          }
        }
      );
    });
  },
};

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  if (!fs.existsSync(DRAWIO_DIR)) {
    throw new Error('Missing .drawio/webapp. Run scripts/vendor-drawio.sh first.');
  }
  return merge(baseConfig, {
    plugins: [
      readmeUrlsPlugin,
      new CopyWebpackPlugin({
        patterns: [
          { from: DRAWIO_DIR, to: 'drawio', info: { minimized: true } },
          { from: DRAWIO_SHIM, to: 'drawio/js/dmap-shim.js', info: { minimized: true } },
        ],
      }),
    ],
    optimization: {
      splitChunks: {
        cacheGroups: {
          // The bindings popup, the YAML option editor and the option editors import these modules. Each is under
          // the default 20 KB minSize, so webpack copied them into every lazy chunk that uses them. One chunk holds
          // them once. The group is async only: module.js (view mode) never gets these modules
          // (src/viewChunk.test.ts). The YAML parser stays in the config-yaml-editor chunk (webpack names it).
          editorShared: {
            test: SHARED_EDITOR_MODULES,
            name: 'editor-shared',
            chunks: 'async',
            minChunks: 2,
            minSize: 0,
            priority: 20,
          },
        },
      },
    },
    performance: { hints: false },
  });
};

export default config;
