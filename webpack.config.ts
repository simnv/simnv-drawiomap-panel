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
 * Copies the vendored draw.io webapp (scripts/vendor-drawio.sh) to dist/drawio.
 * The files are already minified: Terser must not process them.
 */
const DRAWIO_DIR = path.resolve(process.cwd(), '.drawio', 'webapp');

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  if (!fs.existsSync(DRAWIO_DIR)) {
    throw new Error('Missing .drawio/webapp. Run scripts/vendor-drawio.sh first.');
  }
  return merge(baseConfig, {
    plugins: [
      new CopyWebpackPlugin({
        patterns: [{ from: DRAWIO_DIR, to: 'drawio', info: { minimized: true } }],
      }),
    ],
    performance: { hints: false },
  });
};

export default config;
