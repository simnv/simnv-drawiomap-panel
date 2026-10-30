import type { DataFrame, DisplayValue, Field, GrafanaTheme2, ScopedVars, ThresholdsConfig } from '@grafana/data';
import type { ArrowStyle, LinkLabelMode } from './model/v4';
import type { StatusView } from './binding/status';

/* ---------- cells (from the SVG) ---------- */

/** The kind of a cell from its `pg-kind`, or from its geometry in a plain draw.io diagram. */
export type CellKind = 'node' | 'port' | 'link' | 'link-label' | 'other';

/** The element of a node that a status or a value paints. */
export type ShapeTarget = 'icon' | 'shape' | 'stroke';

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
  /** The v4 configuration: classes and overrides (spec 2.2). The panel reads it through `validateConfig`. */
  config?: unknown;
  /**
   * The build id that the generator writes (spec 7.3.5). The panel reads it only to tell a generated panel apart in
   * the inspector (spec 5.4).
   */
  build?: string;
  /** Removed: the rules of version 1. A saved value loads, the panel ignores it and shows a warning. */
  rules?: unknown[];
  zoom: ZoomOptions;
  linkWidth: { min: number; max: number };
  /** The status band above the diagram: one row per cause. maxRows 0 hides the band. Default: 3. */
  summary?: { maxRows: number };
  /** The cells that open a hover or pinned card. Default: node, link, port, other. */
  hover?: { kinds: HoverKind[] };
  /** The colour legend in a corner of the panel. Default: shown, collapsed, bottom-right. */
  legend?: LegendOptions;
}

export type LegendCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface LegendOptions {
  show: boolean;
  corner: LegendCorner;
  /** The legend starts as a small chip. A missing key means collapsed. */
  collapsed?: boolean;
}

/** The options after the defaults: the panel reads these. Internal, never saved. */
export interface ResolvedOptions extends Options {
  summary: { maxRows: number };
  hover: { kinds: HoverKind[] };
  legend: LegendOptions;
}

export const DEFAULT_OPTIONS: ResolvedOptions = {
  zoom: { mode: 'fit', percent: 100, wheel: false, pan: false, align: 'top' },
  linkWidth: { min: 2, max: 10 },
  summary: { maxRows: 3 },
  hover: { kinds: ['node', 'link', 'port', 'other'] },
  legend: { show: true, corner: 'bottom-right', collapsed: true },
};

/**
 * The saved options with the defaults below them, one level deep. Old saved options can have no summary, hover or
 * legend, and a group can have only some of its keys: the defaults fill the rest. Other keys go through unchanged.
 */
export function withDefaults(options: Options): ResolvedOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    zoom: { ...DEFAULT_OPTIONS.zoom, ...options.zoom },
    linkWidth: { ...DEFAULT_OPTIONS.linkWidth, ...options.linkWidth },
    summary: { ...DEFAULT_OPTIONS.summary, ...options.summary },
    hover: { ...DEFAULT_OPTIONS.hover, ...options.hover },
    legend: { ...DEFAULT_OPTIONS.legend, ...options.legend },
  };
}

/** Where the capacity of a link half comes from. The first source that gives a value wins, in this order. */
export type CapacitySource = 'series' | 'attr' | 'none';

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

/**
 * The fields of a v4 status (spec 3.4, `StatusV4`) on the status of a patch. Each status comes from `statusViewOf`,
 * which sets `severity` and `refId`. A status paints with the exact colour of its value (`statusPaint`).
 */
export interface StatusV4Fields {
  /** the rank for the worst of N, the status band and the legend */
  severity: StatusView['state'];
  /** the display colour of the value; a transparent colour keeps the drawn colour */
  color?: string;
  text?: string;
  refId: string;
  /** the raw value that gives `color` and `text`; the legend finds the mapping of the value with it */
  value?: number;
}

export interface CellPatch {
  cellId: string;
  scope: TemplateScope;
  /** `labelMode`: what the value label of each half shows (`display.link.label.mode`, `none` when absent) */
  link?: { a2b?: HalfState; b2a?: HalfState; labelMode?: LinkLabelMode; arrow?: ArrowStyle };
  shape?: ShapeState;
  /**
   * The cell is configured but nothing binds: an item that touched it was skipped, or its id is ambiguous. The
   * applier paints it in the no-data colour and never restores the drawn fill.
   */
  unavailable?: { reason: string; color: string };
  /** the display url after template resolution; dashboard variables are resolved later by replaceVariables */
  urls: LinkTarget[];
  statusView?: StatusView & StatusV4Fields;
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

/** The inputs of the hover card: the part of the bind inputs that the card reads. */
export type CardContext = Pick<BindContext, 'theme' | 'replaceVariables' | 'fieldThresholds'>;

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
