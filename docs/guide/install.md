# Install

Each [GitHub release](https://github.com/simnv/simnv-drawiomap-panel/releases/latest) has the plugin zip `simnv-drawiomap-panel-<version>.zip` and the same zip as `simnv-drawiomap-panel.zip`, each with a `.sha256` file. The URL `https://github.com/simnv/simnv-drawiomap-panel/releases/latest/download/simnv-drawiomap-panel.zip` always points to the latest release. The zip has one top folder, `simnv-drawiomap-panel`.

The plugin is not signed. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=simnv-drawiomap-panel` (or `allow_loading_unsigned_plugins` in `grafana.ini`) for each method below. Restart Grafana after you install or update the plugin.

To install an older version, use the versioned zip of that release.

## Grafana CLI

```bash
grafana cli --pluginUrl https://github.com/simnv/simnv-drawiomap-panel/releases/latest/download/simnv-drawiomap-panel.zip plugins install simnv-drawiomap-panel
```

## Docker

Grafana installs the plugin before it starts. The format is `<plugin id>@<version>@<zip URL>`. The version can be empty.

```bash
docker run -d -p 3000:3000 \
  -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=simnv-drawiomap-panel \
  -e GF_PLUGINS_PREINSTALL_SYNC=simnv-drawiomap-panel@@https://github.com/simnv/simnv-drawiomap-panel/releases/latest/download/simnv-drawiomap-panel.zip \
  grafana/grafana:13.2.4
```

## By hand

Use this method, for example, when the Grafana host has no internet access. Check the zip, then extract it into the plugin directory (`[paths] plugins` in `grafana.ini`, default `/var/lib/grafana/plugins`).

```bash
curl -LO https://github.com/simnv/simnv-drawiomap-panel/releases/latest/download/simnv-drawiomap-panel.zip
curl -LO https://github.com/simnv/simnv-drawiomap-panel/releases/latest/download/simnv-drawiomap-panel.zip.sha256
sha256sum -c simnv-drawiomap-panel.zip.sha256
unzip simnv-drawiomap-panel.zip -d /var/lib/grafana/plugins
```
