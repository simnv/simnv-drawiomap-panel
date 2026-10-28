/**
 * The two pilot configs of the v4 spec (sections 8.1 and 8.2), with the names of the demo network. Each function
 * returns a new object, so a test can change its copy.
 */

/** net-l2-dm: nodes, links, direction and capacity (spec 8.1). */
export function netL2Pilot() {
  return {
    version: 4,
    freshness: '3x',
    classes: {
      device: {
        rows: [{ kind: 'metadata', label: 'Role', text: '${object_class}' }],
      },
      host: {
        extends: 'device',
        match: { key: 'job' },
        status: 'scrape_up',
        rows: [
          { kind: 'history', query: 'host_cpu' },
          { kind: 'history', query: 'host_mem' },
          { kind: 'value', query: 'host_uptime' },
          { kind: 'drilldown', label: 'Open host', url: '/d/host?var-job=${key}' },
        ],
        url: '/d/host?var-job=${key}',
      },
      'unifi-switch': {
        extends: 'device',
        match: { key: 'name' },
        status: 'unifi_dev_health',
        rows: [
          { kind: 'history', query: 'unifi_dev_cpu' },
          { kind: 'value', query: 'unifi_dev_poe_budget' },
        ],
      },
      'unifi-client': {
        match: { key: 'name' },
        status: 'unifi_client_health',
      },
      camera: {
        match: { key: 'device' },
        status: 'hik_up',
      },
      lan: {
        match: { key: 'name', port: 'port_num' },
        up: 'lan_tx',
        down: 'lan_rx',
        capacity: 'unifi_port_speed',
        status: 'lan_state',
        missing: 'down',
        linkLabel: 'percent',
        rows: [
          { kind: 'updown', up: 'lan_tx', down: 'lan_rx', label: 'Traffic' },
          { kind: 'metadata', label: 'Path', text: '${path_role}' },
        ],
      },
    },
    overrides: {
      'pg-link~p-a1-15': {
        rows: [{ kind: 'metadata', label: 'Note', text: 'second uplink' }],
      },
    },
  };
}

/** boiler-enclosure: bound cells, key and port, text on the cell, N lines (spec 8.2). */
export function boilerPilot() {
  return {
    version: 4,
    freshness: '3x',
    classes: {
      controller: {
        match: { key: 'job' },
        status: 'wb7_up',
        freshness: '180s',
        url: '/d/ctl-a',
        rows: [
          { kind: 'history', query: 'wb7_temp', label: 'SoC' },
          { kind: 'value', query: 'wb7_uptime', label: 'Uptime' },
          { kind: 'drilldown', label: 'Open dashboard', url: '/d/ctl-a' },
        ],
      },
      'relay-module': {
        match: { key: 'entity="switch.wb_mr6cu_${key}_k1"' },
        status: 'mr6cu_avail',
        rows: [{ kind: 'drilldown', label: 'Open dashboard', url: '/d/home-assistant' }],
      },
      'relay-output': {
        match: { key: 'entity="switch.wb_mr6cu_${key}_k${port}"' },
        text: { query: 'relay' },
        rows: [{ kind: 'history', query: 'relay', label: 'State' }],
      },
      'mains-monitor': {
        match: { key: 'entity=~"binary_sensor[.]wb_mrwm2_${key}_urms_normal_k[12]"' },
        status: 'mrwm2_norm',
        rows: [
          {
            kind: 'history',
            query: 'volt',
            label: 'Voltage',
            match: { key: 'entity=~"sensor[.]wb_mrwm2_${key}_urms_l[12]"' },
          },
          { kind: 'drilldown', label: 'Open dashboard', url: '/d/home-assistant' },
        ],
      },
      boiler: {
        match: { key: 'entity="sensor.wbe2_i_opentherm_${key}_boiler_fault_indication"' },
        status: 'boiler_fault',
        freshness: '300s',
        url: '/d/home-assistant',
        rows: [
          {
            kind: 'value',
            query: 'boiler_err',
            label: 'Error code',
            unit: 'none',
            match: { key: 'entity="sensor.wbe2_i_opentherm_${key}_error_code"' },
          },
          { kind: 'drilldown', label: 'Open dashboard', url: '/d/home-assistant' },
        ],
      },
    },
  };
}
