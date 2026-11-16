import type { DataQueryRequest } from '@grafana/data';
import type { DataQuery, DataSourceRef } from '@grafana/schema';

/** The datasource and the expression of one panel query. */
export interface QueryInfo {
  /** The name of the datasource, or a fallback that names it ("the panel datasource" when the query has none). */
  datasource: string;
  /** The query text with the dashboard variables applied (the PromQL or SQL filters), when the query has one. */
  expression?: string;
}

/** One failed query: its refId and the error text of Grafana. */
export interface FailedQuery {
  refId: string;
  message: string;
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

const isRef = (v: unknown): v is DataSourceRef => !!v && typeof v === 'object';

/**
 * Describes the queries of a panel request: `name` gives the datasource name of a reference (the datasource service of
 * Grafana in the panel), `interpolate` applies the dashboard variables.
 */
export function describeQueries(
  request: DataQueryRequest | undefined,
  name: (ref: DataSourceRef | string) => string | undefined,
  interpolate: (text: string) => string = (t) => t
): (refId: string) => QueryInfo {
  const targets = new Map<string, DataQuery>((request?.targets ?? []).map((t) => [t.refId, t]));
  return (refId) => {
    const target = targets.get(refId);
    const ref = target?.datasource;
    const datasource = (ref && (name(ref) ?? (isRef(ref) ? (ref.uid ?? ref.type) : ref))) || 'The panel datasource';
    const raw = EXPRESSION_FIELDS.map((f) => (target as unknown as Record<string, unknown> | undefined)?.[f]).find(
      (v): v is string => typeof v === 'string' && v.trim() !== ''
    );
    const text = raw === undefined ? undefined : interpolate(raw).replace(/\s+/g, ' ').trim();
    const expression = text && text.length > MAX_EXPRESSION ? `${text.slice(0, MAX_EXPRESSION - 1)}…` : text;
    return { datasource, expression };
  };
}

/** The cause of an error text in plain words. Unknown texts give "cannot run the query". */
export function failureCause(message: string): string {
  const m = message.toLowerCase();
  if (/no such host|enotfound|name or service not known|server misbehaving/.test(m)) {
    return 'is not reachable (host not found)';
  }
  if (/connection refused|econnrefused/.test(m)) {
    return 'is not reachable (connection refused)';
  }
  if (/timeout|timed out|deadline exceeded|etimedout/.test(m)) {
    return 'does not answer (time-out)';
  }
  if (/no route to host|network is unreachable|ehostunreach|enetunreach/.test(m)) {
    return 'is not reachable (no network route)';
  }
  if (/\b(unauthori[sz]ed|401)\b/.test(m)) {
    return 'refuses the access (401, check the credentials)';
  }
  if (/\b(forbidden|403)\b/.test(m)) {
    return 'refuses the access (403)';
  }
  if (/(data ?source|datasource).*(not found|does not exist)|plugin not found/.test(m)) {
    return 'is not found (check the datasource of the query)';
  }
  const status = /\b(50[0-9])\b/.exec(m);
  if (status || /bad gateway|service unavailable|internal server error/.test(m)) {
    return `has a server error${status ? ` (${status[1]})` : ''}`;
  }
  if (/parse error|syntax error|bad_data|invalid/.test(m)) {
    return 'rejects the query (check the query text)';
  }
  return 'cannot run the query';
}

/**
 * Groups failed queries by datasource and cause, in the order of their first query. A datasource that is down gives
 * one group, not one line for each query.
 */
export function groupQueryFailures(failed: readonly FailedQuery[], info: (refId: string) => QueryInfo): QueryFailure[] {
  const groups = new Map<string, QueryFailure>();
  for (const { refId, message } of failed) {
    const { datasource, expression } = info(refId);
    const cause = failureCause(message);
    const key = JSON.stringify([datasource, cause]);
    let group = groups.get(key);
    if (!group) {
      group = { datasource, cause, details: message, queries: [] };
      groups.set(key, group);
    }
    if (!group.queries.some((q) => q.refId === refId)) {
      group.queries.push({ refId, expression });
    }
  }
  return [...groups.values()];
}

/** The short label of a group, for one status band row: "VictoriaMetrics is not reachable". */
export const failureLabel = (f: Pick<QueryFailure, 'datasource' | 'cause'>) =>
  `${f.datasource} ${f.cause.replace(/ \(.*\)$/, '')}`;

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
