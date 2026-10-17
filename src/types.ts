import type { DataFrame, DisplayValue, Field, GrafanaTheme2, ScopedVars, ThresholdsConfig } from '@grafana/data';

/* ---------- cells (from the SVG) ---------- */

export type CellKind = 'node' | 'port' | 'link' | 'link-label' | 'other';

/** One end of a link, parsed from pg-from / pg-to ("node", "node:port", "node:port#2"). */
export interface Endpoint {
  node: string;
  port?: string;
  ordinal: number;
  raw: string;
}

/** Pure description of one SVG cell group. No DOM references. */
export interface CellMeta {
  /** data-cell-id */
  id: string;
  kind: CellKind;
  /** pg-id when present, else id */
  key: string;
  /** data-meta-* attributes without the prefix, e.g. { 'pg-kind': 'link', capacity: '1000000000' } */
  attrs: Record<string, string>;
  /** Visible label text. For a link: the text of its link-label cell (pg-of), else its own label. */
  labelText: string;
  isEdge: boolean;
  from?: Endpoint;
  to?: Endpoint;
}

export interface CellEntry {
  meta: CellMeta;
  group: SVGGElement;
  /** First shape primitive of a vertex (rect|path|ellipse|polygon|image) outside the label group. */
  shape?: SVGGraphicsElement;
  /** Edge polyline: first path with fill="none". */
  line?: SVGPathElement;
  /** Edge arrow heads: later paths with pointer-events="all". */
  arrows: SVGPathElement[];
  /** Label element: a <text>, the <g> around the <text> lines of a multi-line label, or a foreignObject. */
  label?: Element;
  /** Node only: the cell id of its icon (see adapter/portograph nodeIcons). */
  iconId?: string;
  /** Node parts outside the node group (icon, icon tile, description): the cell id of the node. */
  ownerId?: string;
  original: {
    fill?: string;
    stroke?: string;
    /** Inline stroke-width of the edge line, or of the vertex shape. */
    strokeWidth?: string;
    text?: string;
    /** Deep clones of the label child nodes. Reset puts copies of them back after a text patch. */
    labelNodes?: Node[];
  };
}

/** Keyed by cell id (data-cell-id). */
export type CellIndex = Map<string, CellEntry>;

/* ---------- series (from panel data) ---------- */

export interface SeriesInfo {
  refId?: string;
  name: string;
  labels: Record<string, string>;
  values: number[];
  times?: number[];
  field: Field;
  frame: DataFrame;
}

/* ---------- panel options ---------- */

export interface Diagram {
  xml: string;
  svg: string;
  hash: string;
  updatedAt: string;
}

export type ZoomMode = 'fit' | 'fit-width' | 'original' | 'custom';

/** Where a fitted diagram goes when the panel has a different aspect: top (centred horizontally) or centre. */
export type ZoomAlign = 'top' | 'center';

export interface ZoomOptions {
  mode: ZoomMode;
  percent: number;
  wheel: boolean;
  pan: boolean;
  /** Default: top. */
  align?: ZoomAlign;
}

export interface Options {
  diagram?: Diagram;
  rules: Rule[];
  zoom: ZoomOptions;
  linkWidth: { min: number; max: number };
}

export const DEFAULT_OPTIONS: Options = {
  rules: [],
  zoom: { mode: 'fit', percent: 100, wheel: false, pan: false, align: 'top' },
  linkWidth: { min: 2, max: 10 },
};

/* ---------- rules ---------- */

/** Exact string, or /regex/ (JS regex between slashes, optional flags). */
export type Matcher = string;

export interface SeriesSelector {
  refId?: string;
  name?: Matcher;
  match?: Record<string, Matcher>;
}

export interface CellSelector {
  /** cell ids or pg-ids */
  ids?: string[];
  kind?: CellKind | 'any';
  attrs?: Record<string, Matcher>;
  label?: Matcher;
  /** link between two node ids, any direction */
  between?: [string, string];
}

export type ReducerName = 'last' | 'mean' | 'max' | 'min';

/** A series that gives the link capacity, e.g. the port speed. The field unit converts it to bit/s. */
export interface CapacitySeries extends SeriesSelector {
  /** Default: the rule reducer. */
  reducer?: ReducerName;
}

/** Where the capacity of a link half comes from. The first source that gives a value wins, in this order. */
export type CapacitySource = 'series' | 'attr' | 'number' | 'fieldMax' | 'none';

export interface LinkRule {
  a2b?: SeriesSelector;
  b2a?: SeriesSelector;
  /**
   * bit/s: a number, a template like "${cell.capacity}", or a series selector.
   * Without it, or when it gives no value, the Max of the field config of the half applies.
   */
  capacity?: string | number | CapacitySeries;
  /** The hover card of the link. */
  card?: LinkCardRule;
}

export interface LinkCardRule {
  /** click target of the a2b and b2a rows (template). Default: the rule url. */
  url?: string;
  /** card title (template). Default: the link label text, else the pg-id. */
  title?: string;
}

/** What the state colour changes: the node icon (default), the whole shape fill, or the shape outline. */
export type ShapeTarget = 'icon' | 'shape' | 'stroke';

/** One row of the hover card: a title, the current value and a sparkline of one series. */
export interface CardRow extends SeriesSelector {
  /** row title (template). Default: the series name. */
  title?: string;
  /** Grafana unit id, for example "percent". Default: the field unit. */
  unit?: string;
  decimals?: number;
  /** click target of the row (template). Default: the rule url. */
  url?: string;
}

export interface ShapeRule {
  series?: SeriesSelector;
  target?: ShapeTarget;
  /** old form of target: shape */
  fill?: boolean;
  /** old form of target: stroke */
  stroke?: boolean;
  text?: boolean;
  /** hover card rows. Default: one row for `series`. */
  card?: CardRow[];
  /** removed (no canvas sparklines). The rule parser accepts it, the engine ignores it with a warning. */
  sparkline?: SeriesSelector & { position?: string };
}

export interface Rule {
  name: string;
  select: CellSelector;
  link?: LinkRule;
  shape?: ShapeRule;
  reducer?: ReducerName;
  /** template of the text that shape.text writes into the node label; default "${value}". Links ignore it. */
  label?: string;
  /** Removed. The parser accepts it so that old dashboards load; the engine ignores it with a warning. */
  thresholds?: unknown;
  url?: string;
  /** title of the url in the card footer (template). Default: "Open dashboard" or "Open <card title>". */
  urlTitle?: string;
}

/* ---------- binding output ---------- */

export type BindStatus = 'ok' | 'nodata' | 'unbound';

export interface TemplateScope {
  cell: Record<string, string>;
  from?: Record<string, string>;
  to?: Record<string, string>;
  labels?: Record<string, string>;
  value?: string;
  percent?: string;
}

export interface HalfState {
  status: BindStatus;
  color: string;
  width: number;
  /** "41 Mb/s · 41% of 100 Mb/s", "no data" or "unbound". The hover card shows it. */
  label: string;
  /** index into the threshold steps that produced the colour; -1 when no data */
  stepIndex: number;
  value?: number;
  percent?: number;
  /** bit/s, when the half has a capacity */
  capacity?: number;
  capacitySource?: CapacitySource;
  display?: DisplayValue;
  series?: SeriesInfo;
}

export interface ShapeState {
  status: BindStatus;
  color: string;
  /** none: the state shows in the text only */
  target: ShapeTarget | 'none';
  stepIndex: number;
  text?: string;
  value?: number;
  display?: DisplayValue;
  series?: SeriesInfo;
}

export interface LinkTarget {
  /** the resolved urlTitle; without it the card gives a default title */
  title?: string;
  url: string;
}

/** Card configuration of a cell. The card resolves it only when it opens (see interact/card). */
export interface CardSpec {
  /** title template */
  title?: string;
  /** link rows: click target template */
  url?: string;
  /** shape rows */
  rows?: CardRow[];
  reducer: ReducerName;
}

export interface CellPatch {
  cellId: string;
  ruleNames: string[];
  scope: TemplateScope;
  link?: { a2b?: HalfState; b2a?: HalfState };
  shape?: ShapeState;
  card?: CardSpec;
  /** rule url(s) after template resolution; dashboard variables are resolved later by replaceVariables */
  urls: LinkTarget[];
  warnings: string[];
}

export type PatchMap = Map<string, CellPatch>;

export interface BindContext {
  theme: GrafanaTheme2;
  /** The panel default thresholds. They apply when a field has no thresholds. */
  fieldThresholds?: ThresholdsConfig;
  /** Grafana replaceVariables from PanelProps */
  replaceVariables: (text: string, scopedVars?: ScopedVars) => string;
  /** formats a raw value with the field's display processor (unit, decimals, mappings) */
  display: (series: SeriesInfo, value: number) => DisplayValue;
  linkWidth: { min: number; max: number };
}

export interface BindResult {
  patches: PatchMap;
  warnings: string[];
}

/* ---------- editor ---------- */

export interface DrawioModalProps {
  xml: string;
  title?: string;
  /** edit: show the editor until the user saves or exits. export-only: load, export svg, close. */
  mode: 'edit' | 'export-only';
  isDark: boolean;
  onSave: (result: { xml: string; svg: string }) => void;
  onClose: () => void;
}
