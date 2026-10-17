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
  original: {
    fill?: string;
    stroke?: string;
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

export interface ZoomOptions {
  mode: ZoomMode;
  percent: number;
  wheel: boolean;
  pan: boolean;
}

export interface Options {
  diagram?: Diagram;
  rules: Rule[];
  editorUrl: string;
  zoom: ZoomOptions;
  linkWidth: { min: number; max: number };
}

export const DEFAULT_OPTIONS: Options = {
  rules: [],
  editorUrl: 'http://localhost:8080',
  zoom: { mode: 'fit', percent: 100, wheel: false, pan: false },
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

export interface RuleThresholds {
  mode: 'percent' | 'absolute';
  /** [threshold, colour name or hex], ascending */
  steps: Array<[number, string]>;
}

export interface LinkRule {
  a2b?: SeriesSelector;
  b2a?: SeriesSelector;
  /** bit/s; number or template like "${cell.capacity}" */
  capacity?: string | number;
}

export type SparklinePosition = 'bottom' | 'top' | 'inside';

export interface SparklineRule extends SeriesSelector {
  position?: SparklinePosition;
}

export interface ShapeRule {
  series?: SeriesSelector;
  fill?: boolean;
  stroke?: boolean;
  text?: boolean;
  sparkline?: SparklineRule;
}

export interface Rule {
  name: string;
  select: CellSelector;
  link?: LinkRule;
  shape?: ShapeRule;
  reducer?: ReducerName;
  /** label template; default "${value} · ${percent}" for links, "${value}" for shapes */
  label?: string;
  thresholds?: RuleThresholds;
  url?: string;
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
  label: string;
  /** index into the threshold steps that produced the colour; -1 when no data */
  stepIndex: number;
  value?: number;
  percent?: number;
  display?: DisplayValue;
  series?: SeriesInfo;
}

export interface ShapeState {
  status: BindStatus;
  color: string;
  fill: boolean;
  stroke: boolean;
  stepIndex: number;
  text?: string;
  value?: number;
  display?: DisplayValue;
  series?: SeriesInfo;
}

export interface SparklineState {
  values: number[];
  color: string;
  position: SparklinePosition;
  series?: SeriesInfo;
}

export interface LinkTarget {
  title: string;
  url: string;
}

export interface CellPatch {
  cellId: string;
  ruleNames: string[];
  scope: TemplateScope;
  link?: { a2b?: HalfState; b2a?: HalfState };
  shape?: ShapeState;
  sparkline?: SparklineState;
  /** rule url(s) after template resolution; dashboard variables are resolved later by replaceVariables */
  urls: LinkTarget[];
  warnings: string[];
}

export type PatchMap = Map<string, CellPatch>;

export interface BindContext {
  theme: GrafanaTheme2;
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
  editorUrl: string;
  xml: string;
  title?: string;
  /** edit: show the editor until the user saves or exits. export-only: load, export svg, close. */
  mode: 'edit' | 'export-only';
  isDark: boolean;
  onSave: (result: { xml: string; svg: string }) => void;
  onClose: () => void;
}
