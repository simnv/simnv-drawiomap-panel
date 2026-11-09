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

## Troubleshooting

**The panel shows "Panel plugin not found", and the Grafana log has these lines:**

```
Plugin is unsigned ... could not find a MANIFEST.txt
Skipping loading plugin due to problem with signature
Plugin validation failed ... has no signature
```

Grafana installed the zip, but it did not get `allow_loading_unsigned_plugins`. When the setting is in effect, the log has `Permitting unsigned plugin` after `Plugin is unsigned`, and the plugin loads. Check the setting:

1. The value is exactly `simnv-drawiomap-panel`. To allow more plugins, separate the ids with commas.
2. In `grafana.ini`, the key is in the section `[plugins]`. With the Helm chart, put it in `grafana.ini` > `plugins`, or in `env` as `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`.
3. Grafana reads the setting only when it starts. Restart Grafana after you change it.
4. To see the value that Grafana uses, open **Administration > General > Settings** (or `GET /api/admin/settings`) and find `allow_loading_unsigned_plugins` in the section `plugins`.

**The panel shows "Panel plugin not found" in the development stack of this repository:** `dist/` has no built plugin. Run `npm run build` before `docker compose up`.
