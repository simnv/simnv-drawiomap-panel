import type { ConfigV4 } from '../model/v4';

/**
 * The bindings of the authoring panel (src/fixtures/authoring.drawio). Fictional routers and constant values: no live
 * infrastructure or credentials. The panel targets are health, detail, trend, tx and rx (scripts/build-dashboard.ts).
 * Health and detail have a device label for each router key; the trend target has device=trend.
 * device-1 and device-2 carry bind=routers and key=router-1 or router-2; chart-1 carries bind=trend-region and
 * key=trend; link-1 carries bind=directional-link, key=node-rtr-a, port=wan1, at=source and cap=100M/50M.
 */
export const authoringConfigV4: ConfigV4 = {
  version: 4,
  freshness: '3x',
  classes: {
    routers: {
      match: { key: 'device' },
      status: 'health',
      rows: [
        { kind: 'value', label: 'Detail value', query: 'detail' },
        { kind: 'history', label: 'Detail history', query: 'detail' },
      ],
    },
    'directional-link': {
      match: { key: 'job', port: 'device' },
      up: 'tx',
      down: 'rx',
      linkLabel: 'none',
      rows: [{ kind: 'updown', label: 'Traffic', unit: 'bps', up: 'tx', down: 'rx' }],
    },
    'trend-region': {
      match: { key: 'device' },
      chart: { kind: 'history', label: 'Standalone trend', query: 'trend' },
    },
  },
  overrides: {},
};
