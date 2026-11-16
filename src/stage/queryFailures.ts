import type { DataQueryError, DataQueryRequest, ScopedVars } from '@grafana/data';
import type { DataQuery, DataSourceRef } from '@grafana/schema';
import { CAPACITY_QUERY_FAILED } from '../binding/capacity';
import type { ReportEntry } from '../binding/report';

/** The datasource and the expression of one panel query. */
export interface QueryInfo {
  /** The name of the datasource, or a fallback that names it ("The panel datasource" when the query has none). */
  datasource: string;
  /**
   * The query text with the dashboard variables applied (the PromQL or SQL filters), when the query has one. The
   * macros of the datasource (for example `$__rate_interval`) stay as written.
   */
  expression?: string;
}

/** One failed query: its refId and the error text of Grafana. */
export interface FailedQuery {
  refId: string;
  message: string;
  /** The error has no refId: the whole panel request failed, not this query alone. */
  requestWide?: boolean;
}

/** The failed queries of one datasource with one cause. */
export interface QueryFailure {
  datasource: string;
  /** The cause in plain words, for example "is not reachable (host not found)". */
  cause: string;
  /** The error text of the first failed query: the queries of a group usually share it. */
  details: string;
  queries: Array<{ refId: string; expression?: string }>;
}

/** The text fields that the common datasources use for the query (Prometheus, Loki, SQL, Graphite, Elasticsearch). */
const EXPRESSION_FIELDS = ['expr', 'query', 'rawSql', 'rawQuery', 'target', 'queryText'] as const;
/** A long expression is cut: the tooltip is narrow. */
const MAX_EXPRESSION = 160;
/** A tooltip lists at most this many queries of one datasource; the rest is a count. */
const MAX_QUERIES = 8;
/** The name of a group of queries that failed with one request-wide error, on more than one datasource. */
export const PANEL_REQUEST = 'A datasource of the panel';

const isRef = (v: unknown): v is DataSourceRef => !!v && typeof v === 'object';

/**
 * Describes the queries of a panel request: `name` gives the datasource name of a reference (the datasource service of
 * Grafana in the panel), `interpolate` applies the dashboard variables (with the scoped variables of the request). A
 * datasource given as a variable (`${ds}`) is named by the datasource that the variable selects.
 */
export function describeQueries(
  request: DataQueryRequest | undefined,
  name: (ref: DataSourceRef | string) => string | undefined,
  interpolate: (text: string, scopedVars?: ScopedVars) => string = (t) => t
): (refId: string) => QueryInfo {
  const targets = new Map<string, DataQuery>((request?.targets ?? []).map((t) => [t.refId, t]));
  const apply = (text: string) => interpolate(text, request?.scopedVars);
  const resolve = (ref: DataSourceRef | string): DataSourceRef | string => {
    if (typeof ref === 'string') {
      return ref.includes('$') ? apply(ref) : ref;
    }
    return ref.uid?.includes('$') ? { ...ref, uid: apply(ref.uid) } : ref;
  };
  return (refId) => {
    const target = targets.get(refId);
    const ref = target?.datasource ? resolve(target.datasource) : undefined;
    const datasource = (ref && (name(ref) ?? (isRef(ref) ? (ref.uid ?? ref.type) : ref))) || 'The panel datasource';
    const raw = EXPRESSION_FIELDS.map((f) => (target as unknown as Record<string, unknown> | undefined)?.[f]).find(
      (v): v is string => typeof v === 'string' && v.trim() !== ''
    );
    const text = raw === undefined ? undefined : apply(raw).replace(/\s+/g, ' ').trim();
    const expression = text && text.length > MAX_EXPRESSION ? `${text.slice(0, MAX_EXPRESSION - 1)}…` : text;
    return { datasource, expression };
  };
}

/** An HTTP status in an error text: "status 502", "status code: 401", "HTTP 403", or a text that starts with it. */
function httpStatus(m: string): number | undefined {
  const found = /(?:status(?: code)?|http)[\s:=]*([45]\d\d)\b/.exec(m) ?? /^([45]\d\d)\b/.exec(m);
  return found ? Number(found[1]) : undefined;
}

/** The cause of an error text in plain words. Unknown texts give "cannot run the query". */
export function failureCause(message: string): string {
  const m = message.toLowerCase().trim();
  // the datasource answered: the query text or its cost is the cause
  // a JSON parse error is a page that is not the datasource (a proxy error page), not a query text error
  if (/parse error|syntax error|bad_data|unexpected token|unparsed data|cannot parse/.test(m) && !/json/.test(m)) {
    return 'rejects the query (check the query text)';
  }
  if (/query timed out|query processing would load too many|too many samples|query is too expensive/.test(m)) {
    return 'stops the query (the query takes too long)';
  }
  if (/no such host|enotfound|name or service not known|server misbehaving/.test(m)) {
    return 'is not reachable (host not found)';
  }
  if (/connection refused|econnrefused/.test(m)) {
    return 'is not reachable (connection refused)';
  }
  if (/no route to host|network is unreachable|ehostunreach|enetunreach/.test(m)) {
    return 'is not reachable (no network route)';
  }
  if (/timeout|timed out|deadline exceeded|etimedout/.test(m)) {
    return 'does not answer (time-out)';
  }
  if (/(data ?source|datasource).*(not found|does not exist)|plugin not found/.test(m)) {
    return 'is not found (check the datasource of the query)';
  }
  const status = httpStatus(m);
  if (status === 401 || /\bunauthori[sz]ed\b|invalid api key|invalid username or password/.test(m)) {
    return 'refuses the access (401, check the credentials)';
  }
  if (status === 403 || /\bforbidden\b/.test(m)) {
    return 'refuses the access (403)';
  }
  if ((status !== undefined && status >= 500) || /bad gateway|service unavailable|internal server error/.test(m)) {
    return `has a server error${status !== undefined && status >= 500 ? ` (${status})` : ''}`;
  }
  return 'cannot run the query';
}

/**
 * The failed queries of a bind report, with the error of each from the panel data. A refId with an error of its own
 * gets that error. A refId that failed with an error that has no refId (or with no error text) gets the request-wide
 * error. Grafana 12.3 and 12.4 set only the deprecated `error` for a request that threw.
 */
export function failedQueries(
  report: readonly ReportEntry[],
  data: { errors?: DataQueryError[]; error?: DataQueryError }
): FailedQuery[] {
  const errors = [...(data.errors ?? []), ...(data.error ? [data.error] : [])];
  const out: FailedQuery[] = [];
  for (const entry of report) {
    if (entry.kind !== 'query-unavailable' || entry.state !== 'error') {
      continue;
    }
    const own = errors.find((e) => e.refId === entry.refId);
    const wide = errors.find((e) => !e.refId);
    out.push(
      own
        ? { refId: entry.refId, message: own.message ?? entry.message }
        : { refId: entry.refId, message: wide?.message ?? entry.message, requestWide: true }
    );
  }
  return out;
}

/**
 * Groups failed queries by datasource and cause, in the order of their first query. A datasource that is down gives
 * one group, not one line for each query. A request-wide error names no datasource when its queries use more than one:
 * it does not tell which datasource failed.
 */
export function groupQueryFailures(failed: readonly FailedQuery[], info: (refId: string) => QueryInfo): QueryFailure[] {
  const wideSources = new Set(failed.filter((f) => f.requestWide).map((f) => info(f.refId).datasource));
  const groups = new Map<string, QueryFailure>();
  for (const { refId, message, requestWide } of failed) {
    const described = info(refId);
    const datasource = requestWide && wideSources.size > 1 ? PANEL_REQUEST : described.datasource;
    const cause = failureCause(message);
    const key = JSON.stringify([datasource, cause]);
    let group = groups.get(key);
    if (!group) {
      group = { datasource, cause, details: message, queries: [] };
      groups.set(key, group);
    }
    if (!group.queries.some((q) => q.refId === refId)) {
      group.queries.push({ refId, expression: described.expression });
    }
  }
  return [...groups.values()];
}

/** The short label of a group, for one status band row: "VictoriaMetrics is not reachable". */
export const failureLabel = (f: Pick<QueryFailure, 'datasource' | 'cause'>) =>
  `${f.datasource} ${f.cause.replace(/ \(.*\)$/, '')}`;

/** The band label of each refId of the groups, for `bandRowsV4`. */
export function failedLabels(failures: readonly QueryFailure[]): (refId: string) => string | undefined {
  const labels = new Map<string, string>();
  for (const f of failures) {
    for (const q of f.queries) {
      labels.set(q.refId, failureLabel(f));
    }
  }
  return (refId) => labels.get(refId);
}

/**
 * The entries of a bind report that keep their own warning line: the failed queries have their grouped warnings, and a
 * `capacity-fallback` "query failed" says the same again.
 */
export const otherEntries = (report: readonly ReportEntry[], failed: readonly FailedQuery[]): ReportEntry[] =>
  report.filter(
    (entry) =>
      !(entry.kind === 'query-unavailable' && entry.state === 'error') &&
      !(failed.length && entry.kind === 'capacity-fallback' && entry.reason === CAPACITY_QUERY_FAILED)
  );

/**
 * The warning text of a group: the datasource and the cause, each failed query with its expression, and the error
 * text once. One line for each part.
 */
export function failureText(f: QueryFailure): string {
  const n = f.queries.length;
  const lines = [`${f.datasource} ${f.cause}: ${n} ${n === 1 ? 'query fails' : 'queries fail'}`];
  for (const q of f.queries.slice(0, MAX_QUERIES)) {
    lines.push(`• ${q.refId}${q.expression ? `: ${q.expression}` : ''}`);
  }
  if (n > MAX_QUERIES) {
    lines.push(`• and ${n - MAX_QUERIES} more`);
  }
  lines.push(`Error: ${f.details}`);
  return lines.join('\n');
}
