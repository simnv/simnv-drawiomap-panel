# Reference research: portograph output and metric shapes

This note keeps the generic facts that the panel design uses. Names and addresses in the
examples are fictional (see `fixtures/demo/`).

## 1. portograph

portograph converts YAML to a layout, then to SVG or draw.io. The draw.io binding contract is
copied in [portograph-contract.md](portograph-contract.md). Read it for the full rules.

### 1.1 YAML schema (v2)

```yaml
portograph: 2
profile: network            # network | architecture | electrical
title: "demo-lab — L3"
css: |                      # colour, fill, dash and opacity only; geometry properties are locked
  .link-line.broken { stroke: #c62828; }
groups:
  edge: { tier: 1, label: "Edge routers" }
nodes:
  rtr-a:
    group: edge
    class: router
    label: rtr-a
    description: "multi-WAN + PBR"
    meta: { job: node-rtr-a }                    # binding metadata, exported as attributes
    ports: [br-lan, ts0, { name: wan1, class: "uplink up", meta: { device: wan1 } }]
    size: { width: 300, height: 70 }
links:
  - [net-a.lan, rtr-a.br-lan, { label: "10.10.0.1" }]
  - [lte.static, rtr-a.wan3, { label: "metric 30", class: broken, id: lte-backup }]
```

- Ids match `^[A-Za-z0-9][A-Za-z0-9_-]*$`. Node ids and group ids share one namespace.
- Port names can repeat. A port is identified by its name and a 1-based ordinal.
- Endpoint forms: `node.port`, `node.port#n`, `node.*`, `node`, `group`.
- Port status tokens in `class`: `up down admin-down degraded unused`. Port roles: `uplink downlink
  peer mgmt lag loopback`. Other tokens stay as free CSS classes.
- portograph has no Prometheus, SNMP or ifIndex concept. Port names are free text. In a network
  diagram they are usually the OS interface names (`br-lan`, `eth2`, `eth2.103`).

### 1.2 draw.io output

- One plain, uncompressed XML file with one page:
  `<mxfile host="portograph"><diagram id="pg-diagram" name="{title}"><mxGraphModel ...>`.
  Light and dark colours are in each style as `light-dark(#a,#b)`.
- A bound cell is an `<object>` with `pg-*` attributes (`pg-kind`, `pg-id`, `pg-from`, `pg-to`,
  `pg-node`, `pg-port`, `pg-of`) and the YAML `meta` keys. The root cell carries `pg-schema="1"`.
- Cell ids are deterministic. The scheme is `pg-<kind>~<part>~<part>`. A `%` or a `~` in a part is
  percent-escaped.

| Cell | id |
|---|---|
| layers | `pg-layer~canvas/diagram/overlay/links/labels/legend` |
| group, group title | `pg-group~<groupId>`, `pg-groupTitle~<groupId>` |
| node | `pg-node~<nodeId>` |
| node description | `pg-nodeDescription~<nodeId>` |
| node icon | `pg-icon~<nodeId>`, `pg-iconTile~<nodeId>` |
| port pill | `pg-port~<nodeId>~<portName>~<ordinal>` |
| link | `pg-link~<link id>`, `pg-link~<link id>~<i>` for run i of a split link |
| link label | `pg-linkLabel~<link id>` |

- A link id is the YAML `id:`, or `<from>-><to>` from its ends (`isp-a:pppoe->rtr-a:wan1`).
- Edge `source` and `target` point to port cells, or to the node cell for an anonymous end.
  Direction is the YAML order: from is the source, to is the target.
- The link label is a separate cell. The panel attaches it to its link through `pg-of`.

draw.io pitfalls that the portograph exporter records (useful for any parser):

1. `html=1` labels are HTML-escaped inside the XML-decoded value (double escaping).
2. Child geometry is relative to the top-left corner of the parent.
3. Edge waypoints are absolute only for edges whose parent is a layer.
4. draw.io drops an `<mxStylesheet>`. Every style is inline.
5. `exitX` and `exitY` must come as a pair.
6. The `x` of an edge label is the arc length along the polyline, and `y` is a perpendicular offset.

## 2. Typical metric shapes

node_exporter (OpenWrt, Linux hosts), scraped on `:9100`:

- One scrape job per host is a common convention: `job="node-<host>"`. `instance` is the scrape address.
- Interface series have the OS interface name in `device`, also for VLAN sub-interfaces
  (`device="eth2.103"`) and PPPoE devices (`device="pppoe-wan1"`).

```promql
rate(node_network_transmit_bytes_total{job="node-rtr-a",device="wan1"}[5m]) * 8
rate(node_network_receive_bytes_total{job="node-rtr-a",device="wan1"}[5m]) * 8
node_network_speed_bytes{job="node-rtr-a",device="br-lan"}        # port speed, bytes/s
up{job="node-rtr-a"}
100 * (1 - avg(rate(node_cpu_seconds_total{job="node-rtr-a",mode="idle"}[5m])))
```

Switch exporters often use other label names, for example `host` for the device and `name` for
the interface. Thus the panel must match series by any label, not only by `job` and `device`.

Thus the convention `job=node-<node id>, device=<port name>` follows from portograph ids, but only
through user templates. The panel rules use templates such as `node-${from.node}` and `${from.port}`.

## 3. Design facts from earlier topology dashboards

- Bind each cell to its queries explicitly: a key per node (`n:<nodeId>`, `n:<nodeId>:cpu`) and per
  link half (`l:<linkId>:a2b`, `l:<linkId>:b2a`).
- A link has two ends (`a`, `b`), a kind (`wan`, `lan`, ...), a capacity per direction and one
  query per direction, plus an optional link-state query.
- Utilisation ramps differ by link kind. Gigabit LAN ports run at a very low utilisation, so a LAN
  ramp needs lower steps (for example `[0, 0.1, 0.5, 2, 10]` percent against `[0, 5, 20, 50, 80]`).
- Link state: `1` is up, `0.5` is transitional, `0` is down, an absent series is no data. A missing
  series shows as no-data grey, never as green.

## 4. Implications for the panel

1. Parse the draw.io XML in the browser: plain and compressed, `mxfile` and bare `mxGraphModel`.
2. Bind by `pg-id` or by a custom attribute (draw.io *Edit Data*). Link ids from the link ends
   survive a reorder of the YAML.
3. Rewrite colours inline and handle the `light-dark()` form.
4. Link direction is source to target, with two series (a2b, b2a), threshold sets per link and
   no-data handling.
5. Match series by refId and by any label (`job`, `device`, `name`, `instance`).
