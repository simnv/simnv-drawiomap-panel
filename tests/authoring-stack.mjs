// Generate an isolated, disposable stack. Never use the main checkout's compose lifecycle.
import fs from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2] || 'artifacts/authoring-compat');
const cwd = process.cwd();
const services = {};
for (const [name, version, port, sandbox] of [
  ['grafana12', '12.4.13', 3412, false],
  ['grafana13', '13.2.4', 3413, false],
  ['sandbox12', '12.4.13', 3422, true],
  ['sandbox13', '13.2.4', 3423, true],
]) {
  const environment = {
    GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: 'simnv-drawiomap-panel',
    GF_AUTH_ANONYMOUS_ENABLED: 'true',
    GF_AUTH_ANONYMOUS_ORG_ROLE: 'Admin',
    GF_DEFAULT_APP_MODE: 'development',
    GF_LOG_LEVEL: 'warn',
  };
  if (sandbox) {
    Object.assign(environment, {
      GF_SECURITY_ENABLE_FRONTEND_SANDBOX_FOR_PLUGINS: 'simnv-drawiomap-panel',
      GF_FEATURE_TOGGLES_ENABLE: 'pluginsFrontendSandbox',
    });
  }
  services[name] = {
    image: `grafana/grafana:${version}`,
    ports: [`127.0.0.1:${port}:3000`],
    environment,
    volumes: [
      `${cwd}/dist:/var/lib/grafana/plugins/simnv-drawiomap-panel:ro`,
      `${directory}/provisioning:/etc/grafana/provisioning:ro`,
    ],
  };
}
services.victoriametrics = { image: 'victoriametrics/victoria-metrics:v1.126.0', ports: ['127.0.0.1:3428:8428'] };
services['metrics-gen'] = {
  image: 'python:3.12-alpine',
  volumes: [`${cwd}/stack/metrics-gen:/app:ro`],
  environment: { VM_URL: 'http://victoriametrics:8428' },
  command: ['python', '-I', '/app/gen.py'],
};
fs.mkdirSync(`${directory}/provisioning/datasources`, { recursive: true });
fs.writeFileSync(
  `${directory}/provisioning/datasources/compat.yaml`,
  `apiVersion: 1
datasources:
  - name: Compatibility Prometheus
    uid: compat-prom
    type: prometheus
    access: proxy
    url: http://victoriametrics:8428
    jsonData:
      timeInterval: 5s
  - name: Compatibility TestData
    uid: compat-testdata
    type: grafana-testdata-datasource
    access: proxy
`
);
fs.writeFileSync(`${directory}/compose.json`, JSON.stringify({ services }, null, 2));
console.log(`${directory}/compose.json`);
