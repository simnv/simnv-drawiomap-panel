import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';
import path from 'path';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config.ts';

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

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  if (!fs.existsSync(DRAWIO_DIR)) {
    throw new Error('Missing .drawio/webapp. Run scripts/vendor-drawio.sh first.');
  }
  return merge(baseConfig, {
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          { from: DRAWIO_DIR, to: 'drawio', info: { minimized: true } },
          { from: DRAWIO_SHIM, to: 'drawio/js/dmap-shim.js', info: { minimized: true } },
        ],
      }),
    ],
    performance: { hints: false },
  });
};

export default config;
