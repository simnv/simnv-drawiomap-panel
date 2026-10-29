import { resolveClasses, type ResolvedClass } from '../binding/classes';
import { parseMatchBlock } from '../binding/matcher';
import type { ReportEntry } from '../binding/report';
import { checkTemplate } from '../binding/template';
import { checkChains, parseConfig, type ClassV4, type MatchV4, type OverrideV4, type ParsedConfig } from './v4';
import { yamlPath } from './yamlPath';

type Place = Parameters<typeof checkTemplate>[1];

/** Each match block and each template of one class or override, with its YAML path below the item. */
function itemParts(item: ClassV4 | OverrideV4): {
  blocks: Array<{ path: string; block: MatchV4 }>;
  templates: Array<{ path: string; text: string; place: Place }>;
} {
  const blocks: Array<{ path: string; block: MatchV4 }> = [];
  const templates: Array<{ path: string; text: string; place: Place }> = [];
  const block = (path: string, match: MatchV4 | undefined) => {
    if (match) {
      blocks.push({ path, block: match });
    }
  };
  const template = (path: string, text: string | undefined, place: Place) => {
    if (text !== undefined) {
      templates.push({ path, text, place });
    }
  };
  block('match', item.match);
  block('text.match', item.text?.match);
  block('chart.match', item.chart?.match);
  template('url', item.url, 'url');
  template('urlTitle', item.urlTitle, 'title');
  item.rows?.forEach((row, i) => {
    const at = `rows[${i}]`;
    if (row.kind === 'metadata') {
      template(`${at}.text`, row.text, 'metadata');
    } else if (row.kind === 'drilldown') {
      template(`${at}.label`, row.label, 'title');
      template(`${at}.url`, row.url, 'url');
    } else {
      block(`${at}.match`, row.match);
    }
  });
  return { blocks, templates };
}

/** The `schema` entries of the matchers (spec 2.4 steps 1–3) and of the templates (3.3) of one item. */
function itemEntries(item: ClassV4 | OverrideV4, prefix: string): ReportEntry[] {
  const { blocks, templates } = itemParts(item);
  return [
    ...blocks.flatMap(({ path, block }): ReportEntry[] => {
      const parsed = parseMatchBlock(block, `${prefix}.${path}`);
      return parsed.ok ? [] : parsed.errors.map((e) => ({ kind: 'schema', ...e }));
    }),
    ...templates.flatMap(({ path, text, place }) =>
      checkTemplate(text, place).map((e): ReportEntry => ({ kind: 'schema', path: `${prefix}.${path}`, ...e }))
    ),
  ];
}

/**
 * Validate a v4 config (spec 2.5 steps 1–4). parseConfig runs the envelope, the item schemas and the chains. Then
 * each class and each override gets the matcher steps 1–3 of 2.4 and `checkTemplate` (3.3). A `schema` entry makes
 * its item invalid. A class that becomes invalid here makes its descendants invalid (the chain check runs again).
 * An override that becomes invalid leaves `config.overrides`, as an override that fails its schema does.
 * The report gives all `schema` entries before the chain entries, in the order of the steps.
 * `classes` holds each valid class after `extends`. The input does not change.
 */
export function validateConfig(raw: unknown): {
  parsed: ParsedConfig;
  classes: Map<string, ResolvedClass>;
  report: ReportEntry[];
} {
  const parsed = parseConfig(raw);
  const config = parsed.config;
  if (!config) {
    return { parsed, classes: new Map(), report: parsed.report };
  }
  for (const [name, cls] of Object.entries(config.classes)) {
    const entries = itemEntries(cls, yamlPath(['classes', name]));
    if (entries.length) {
      parsed.invalidClasses.set(name, [...entries, ...(parsed.invalidClasses.get(name) ?? [])]);
      parsed.report.push(...entries);
    }
  }
  for (const [cellId, override] of Object.entries(config.overrides)) {
    const entries = itemEntries(override, yamlPath(['overrides', cellId]));
    if (entries.length) {
      parsed.invalidOverrides.set(cellId, entries);
      parsed.report.push(...entries);
      delete config.overrides[cellId];
    }
  }
  checkChains(parsed);
  // a stable sort: step 2 (schema) before step 3 (the chain)
  parsed.report.sort((a, b) => Number(a.kind !== 'schema') - Number(b.kind !== 'schema'));
  return { parsed, classes: resolveClasses(parsed), report: parsed.report };
}
