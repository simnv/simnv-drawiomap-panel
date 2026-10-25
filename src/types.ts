import type { DataFrame, DisplayValue, Field, GrafanaTheme2, ScopedVars, ThresholdsConfig } from '@grafana/data';
import type { DiagramConfig, LinkLabelMode } from './model/config';

/* ---------- cells (from the SVG) ---------- */

export type CellKind = 'node' | 'port' | 'link' | 'link-label' | 'other';

/**
 * The kind of a cell for the hover card (Options.hover.kinds). Portograph structure cells (canvas and layers,
 * groups and group titles, legend) have their own kinds. Cells of a plain draw.io diagram are nodes (vertices)
 * and links (edges).
 */
export type HoverKind = 'node' | 'link' | 'port' | 'link-label' | 'group' | 'canvas' | 'legend' | 'other';

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
  /** Human-readable name for cards and lists (adapter/cellTitle). A cell that was never indexed has none: use labelText. */
  title?: string;
  /** The cell id for a list or a heading: decoded with pg-schema, raw without it (adapter/cellTitle). */
  handle?: string;
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
  /** Edge end markers drawn as an <ellipse> or <circle> (the dot of a bare end), with the end of the path that each closes. Computed once when the SVG is indexed. */
  ends?: Array<{ el: SVGGraphicsElement; end: 'start' | 'end' }>;
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
  /** Fit and Fit width do not shrink the diagram below this scale (1 = 100 %); the stage scrolls instead. 0: off. */
  minScale?: number;
}

export interface Options {
  diagram?: Diagram;
  /** The authoring configuration: named queries, patterns, overrides and chart regions. */
  config?: DiagramConfig;
  /** Removed: the rules of version 1. A saved value loads, the panel ignores it and shows a warning. */
  rules?: unknown[];
  zoom: ZoomOptions;
  linkWidth: { min: number; max: number };
  /** The status band above the diagram: one row per cause. maxRows 0 hides the band. Default: 3. */
  summary?: { maxRows: number };
  /** The cells that open a hover or pinned card. Default: node, link, port, other. */
  hover?: { kinds: HoverKind[] };
  /** The colour legend in a corner of the panel. Default: shown, collapsed, bottom-right, at most 4 blocks. */
  legend?: LegendOptions;
}

export type LegendCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface LegendOptions {
  show: boolean;
  corner: LegendCorner;
  /** More colour scales go into a "+N more" line. */
  maxBlocks: number;
  /** The legend starts as a small chip. A missing key means collapsed. */
  collapsed?: boolean;
}

export const DEFAULT_OPTIONS: Options = {
  zoom: { mode: 'fit', percent: 100, wheel: false, pan: false, align: 'top' },
  linkWidth: { min: 2, max: 10 },
  summary: { maxRows: 3 },
  hover: { kinds: ['node', 'link', 'port', 'other'] },
  legend: { show: true, corner: 'bottom-right', maxBlocks: 4, collapsed: true },
};

/* ---------- selectors ---------- */

/** Exact string, or /regex/ (JS regex between slashes, optional flags). */
export type Matcher = string;

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

/** Where the capacity of a link half comes from. The first source that gives a value wins, in this order. */
export type CapacitySource = 'series' | 'attr' | 'number' | 'fieldMax' | 'none';

/** What the state colour changes: the node icon (default), the whole shape fill, or the shape outline. */
export type ShapeTarget = 'icon' | 'shape' | 'stroke';

/* ---------- binding output ---------- */

/** unbound: the direction is configured but cannot bind for this cell (its query is unknown, skipped or unusable) */
export type BindStatus = 'ok' | 'nodata' | 'unbound';

export interface TemplateScope {
  cell: Record<string, string>;
  from?: Record<string, string>;
  to?: Record<string, string>;
  labels?: Record<string, string>;
  value?: string;
  percent?: string;
  /** readable title of the cell (adapter/cellTitle); a root of its own, so it never collides with a metadata key */
  cellTitle?: string;
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
  /** `percent` as text (`percentText`: "41%", "<1%", ">999%"); the card and the link labels show it */
  percentDisplay?: string;
  /** the capacity in the canonical unit of the field (bit/s for a data rate), when the half has one */
  capacity?: number;
  capacitySource?: CapacitySource;
  /** the capacity in the unit of the field, formatted once; the card and the labels show it */
  capacityDisplay?: DisplayValue;
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

export interface CellPatch {
  cellId: string;
  /** the ids of the patterns that match the cell */
  ruleNames: string[];
  scope: TemplateScope;
  /** `labelMode`: what the value label of each half shows (`display.link.label.mode`, `none` when absent) */
  link?: { a2b?: HalfState; b2a?: HalfState; labelMode?: LinkLabelMode };
  shape?: ShapeState;
  /**
   * The cell is configured but nothing binds: an item that touched it was skipped, or its id is ambiguous. The
   * applier paints it in the no-data colour and never restores the drawn fill.
   */
  unavailable?: { reason: string; color: string };
  /** the display url after template resolution; dashboard variables are resolved later by replaceVariables */
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
