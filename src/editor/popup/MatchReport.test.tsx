import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportEntry } from '../../binding/report';
import { CONFIG, editorProps } from './splitTestKit';

// @grafana/ui reads matchMedia (uPlot) and localStorage (logger) when it loads. Set them before the imports run.
vi.hoisted(() => {
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

const kit = await vi.hoisted(async () => (await import('./splitTestKit')).createFakeMonaco());
const { fake } = kit;
vi.mock('@grafana/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@grafana/ui')>()),
  CodeEditor: kit.CodeEditor,
}));
const zoom = vi.hoisted(() => ({ fitCells: vi.fn() }));
vi.mock('../../render/zoom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../render/zoom')>();
  zoom.fitCells.mockImplementation(actual.fitCells);
  return { ...actual, fitCells: zoom.fitCells };
});

const { SplitEditor, SETTLE_MS } = await import('./SplitEditor');
const { entryTarget, MatchReport } = await import('./MatchReport');

/** Waits for the editor to read the text after the last keystroke. */
const settle = () => act(() => vi.advanceTimersByTime(SETTLE_MS));
const report = () => screen.getByTestId('dmap-match-report');
const tabs = () => within(report()).getAllByRole('tab');
/** The tab of a group: its label is the class name, or "Not in a class"; a count of entries can follow it. */
const tabOf = (name: string) => {
  const label = name.replace(/^Class /, '');
  return tabs().find((t) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d*$`).test(t.textContent!))!;
};
/** Opens the tab of a group and gives its panel. */
const group = (name: string) => {
  fireEvent.click(tabOf(name));
  return within(report()).getByRole('tabpanel', { name });
};
const active = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;
/** The cells of a count row: cells, 0 series, 1 series, more. The first column is the button of the row. */
const counts = (scope: HTMLElement, label: string) =>
  Array.from(
    within(within(scope).getByRole('table')).getByRole('button', { name: label }).closest('tr')!.querySelectorAll('td')
  ).map((td) => td.textContent);
const lit = () =>
  Array.from(screen.getByTestId('dmap-popup-stage').querySelectorAll('[data-dmap-highlight="true"]')).map((el) =>
    el.getAttribute('data-cell-id')
  );
const type = (text: string) => fireEvent.change(screen.getByTestId('code-editor'), { target: { value: text } });
/** The position of the first `needle` of the text. */
const positionOf = (needle: string) => fake.model.getPositionAt(fake.text.indexOf(needle));

describe('MatchReport in the split editor', () => {
  beforeEach(() => {
    fake.reset();
    zoom.fitCells.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => vi.useRealTimers());

  it('lists the entries of the bind grouped by class, with the counts per class and per use', () => {
    render(<SplitEditor {...editorProps()} />);
    // the report pane is below the code box
    expect(screen.getByTestId('dmap-pane-report').contains(report())).toBe(true);
    const dev = group('Class dev');
    // per class: the cells, then the cells with 0, 1 and more series of their first use
    expect(counts(dev, 'dev, first use')).toEqual(['2', '1', '1', '0']);
    expect(counts(dev, 'status')).toEqual(['', '1', '1', '0']);
    expect(within(dev).getByRole('button', { name: '1 cell has no series' })).toBeTruthy();
    const sw = group('Class sw');
    expect(counts(sw, 'sw, first use')).toEqual(['1', '0', '1', '0']);
    expect(within(sw).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('follows an edit that changes the result', () => {
    render(<SplitEditor {...editorProps()} />);
    // `dev` now selects by a label that no series has
    type(fake.text.replace('key: job', 'key: host'));
    settle();
    expect(counts(group('Class dev'), 'dev, first use')).toEqual(['2', '2', '0', '0']);
    expect(within(group('Class dev')).getByRole('button', { name: '2 cells have no series' }));
    // a YAML error is an entry of its own, and the counts stay at the last valid draft
    type('version: 4\nclasses: [\n');
    settle();
    expect(within(group('Not in a class')).getByRole('button', { name: /^line \d+: / })).toBeTruthy();
    expect(counts(group('Class dev'), 'dev, first use')).toEqual(['2', '2', '0', '0']);
  });

  it('reports arrow on a node class and selects its YAML field', () => {
    const props = editorProps();
    render(
      <SplitEditor
        {...props}
        options={{
          ...props.options,
          config: { ...CONFIG, classes: { ...CONFIG.classes, dev: { ...CONFIG.classes.dev, arrow: 'none' } } },
        }}
      />
    );
    const entry = within(group('Class dev')).getByRole('button', {
      name: 'Not used on 2 cells that are not edges',
    });
    fireEvent.click(entry);
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith(positionOf('arrow: none'));
    expect(lit()).toEqual(['a', 'b']);
  });

  it('a click on an entry highlights its cells and moves the cursor to its path', () => {
    render(<SplitEditor {...editorProps()} />);
    fireEvent.click(within(group('Class dev')).getByRole('button', { name: /cell has no series/ }));
    expect(lit()).toEqual(['b']);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
    expect(zoom.fitCells.mock.calls[0][1]).toEqual(['b']);
    // the use path `classes.dev.status`: the key of the first `status`
    const at = positionOf('status: up');
    expect(fake.editor.setPosition).toHaveBeenCalledWith(at);
    expect(fake.editor.revealLineInCenter).toHaveBeenCalledWith(at.lineNumber);
    // the cursor event of the move does not take the highlight of the entry away
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(['b']);
    // a cursor move of the user does
    act(() => fake.moveTo(fake.text.indexOf('sw:')));
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(['c']);
  });

  it('a click on a count row moves the cursor and lights the cells of its path, as a cursor move does', () => {
    render(<SplitEditor {...editorProps()} />);
    fireEvent.click(within(within(group('Class dev')).getByRole('table')).getByRole('button', { name: 'status' }));
    expect(fake.editor.setPosition).toHaveBeenCalledWith(positionOf('status: up'));
    expect(lit()).toEqual(['a', 'b']);
    fireEvent.click(within(group('Class sw')).getByRole('button', { name: 'sw, first use' }));
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith(positionOf('sw:'));
    expect(lit()).toEqual(['c']);
  });

  it('keeps a report entry selected when an earlier cursor timer expires', () => {
    render(<SplitEditor {...editorProps()} />);
    act(() => fake.moveTo(fake.text.indexOf('sw:')));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(within(group('Class dev')).getByRole('button', { name: /cell has no series/ }));
    expect(lit()).toEqual(['b']);
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(['b']);
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith(positionOf('status: up'));
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
    expect(zoom.fitCells.mock.calls[0][1]).toEqual(['b']);
  });

  it('cancels a pending cursor timer for a report entry without a YAML path', () => {
    const props = editorProps();
    const svg = props.options.diagram!.svg.replace('data-meta-bind="dev"', 'data-meta-bind="unknown"');
    render(<SplitEditor {...props} options={{ ...props.options, diagram: { ...props.options.diagram!, svg } }} />);
    act(() => fake.moveTo(fake.text.indexOf('sw:')));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(within(group('Not in a class')).getByRole('button', { name: /unknown class unknown/ }));
    expect(lit()).toEqual(['a']);
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(['a']);
    expect(fake.editor.setPosition).not.toHaveBeenCalled();
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
  });

  it('the active tab follows the class at the cursor and the class of a clicked cell', () => {
    render(<SplitEditor {...editorProps()} />);
    expect(tabs().map((t) => t.textContent)).toEqual(['dev1', 'sw']);
    // the first tab with entries
    expect(active()).toBe('dev1');
    act(() => fake.moveTo(fake.text.indexOf('sw:')));
    act(() => vi.advanceTimersByTime(150));
    expect(active()).toBe('sw');
    expect(within(report()).getAllByRole('tabpanel')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('dmap-popup-stage').querySelector('[data-cell-id="a"]')!);
    expect(active()).toBe('dev1');
    // the user opens another tab; the next cursor move in a class takes the tab back to that class
    fireEvent.click(tabOf('sw'));
    expect(active()).toBe('sw');
    act(() => fake.moveTo(fake.text.indexOf('dev:')));
    act(() => vi.advanceTimersByTime(150));
    expect(active()).toBe('dev1');
    // a click on a report row keeps the tab
    fireEvent.click(tabOf('sw'));
    fireEvent.click(within(report()).getByRole('button', { name: 'sw, first use' }));
    act(() => vi.advanceTimersByTime(150));
    expect(active()).toBe('sw');
  });

  it('a click on an entry for a class with no cells clears the previous highlight', () => {
    const config = { ...CONFIG, classes: { ...CONFIG.classes, spare: { match: { key: 'job' }, status: 'up' } } };
    render(<SplitEditor {...editorProps({ options: { ...editorProps().options, config } })} />);
    act(() => fake.moveTo(fake.text.indexOf('dev:')));
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(['a', 'b']);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
    fireEvent.click(within(group('Class spare')).getByRole('button', { name: /No cell binds this class/ }));
    expect(fake.editor.setPosition).toHaveBeenCalledWith(positionOf('spare:'));
    expect(lit()).toEqual([]);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
  });
});

describe('MatchReport', () => {
  const empty = { perClass: new Map(), perUse: new Map() };

  it('shows one cause row with a clickable use for each original path', () => {
    const onPick = vi.fn();
    const entries: ReportEntry[] = ['status', 'rows[0]', 'url'].map((use) => ({
      kind: 'missing-attr',
      cls: 'dev',
      path: `classes.dev.${use}`,
      attr: 'key',
      cellIds: ['a', 'b'],
    }));
    const config = {
      version: 4 as const,
      freshness: '1h',
      overrides: {},
      classes: { dev: { rows: [{ kind: 'value' as const, query: 'load', label: 'load 1m' }] } },
    };
    render(<MatchReport entries={entries} counts={empty} config={config} onPick={onPick} />);
    expect(tabOf('dev').textContent).toBe('dev1');
    const row = within(report()).getByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: '2 cells have no attribute `key`' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'entry', path: 'classes.dev.status', cells: ['a', 'b'] });
    expect(within(row).getByText(/Used by/)).toBeTruthy();
    for (const [label, path] of [
      ['status', 'status'],
      ['rows[0] (load 1m)', 'rows[0]'],
      ['url', 'url'],
    ]) {
      fireEvent.click(within(row).getByRole('button', { name: label }));
      expect(onPick).toHaveBeenLastCalledWith({ kind: 'entry', path: `classes.dev.${path}`, cells: ['a', 'b'] });
    }
  });

  it.each([undefined, 'load'])('names the source class on inherited row links when both labels are %s', (label) => {
    const onPick = vi.fn();
    const config = {
      version: 4 as const,
      freshness: '1h',
      overrides: {},
      classes: {
        base: { match: { key: 'job' }, rows: [{ kind: 'value' as const, query: 'load', label }] },
        child: { extends: 'base', rows: [{ kind: 'value' as const, query: 'load', label }] },
      },
    };
    const entries: ReportEntry[] = ['base', 'child'].map((source) => ({
      kind: 'no-series',
      cls: 'child',
      use: `classes.${source}.rows[0]`,
      cellIds: ['a'],
    }));
    render(<MatchReport entries={entries} counts={empty} config={config} onPick={onPick} />);
    const row = within(group('Class child')).getByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: label ? 'base.rows[0] (load)' : 'base.rows[0]' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'entry', path: 'classes.base.rows[0]', cells: ['a'] });
    fireEvent.click(within(row).getByRole('button', { name: label ? 'rows[0] (load)' : 'rows[0]' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'entry', path: 'classes.child.rows[0]', cells: ['a'] });
  });

  it('puts only the active tab before the report controls in the tab order', () => {
    const perClass = new Map([
      ['dev', { cells: 2, zero: 1, one: 1, many: 0 }],
      ['sw', { cells: 1, zero: 0, one: 1, many: 0 }],
      ['lan', { cells: 1, zero: 0, one: 1, many: 0 }],
    ]);
    render(
      <MatchReport entries={[]} counts={{ perClass, perUse: new Map() }} onPick={() => {}} follow={{ group: 'sw' }} />
    );
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    const stops = Array.from(report().querySelectorAll<HTMLButtonElement>('button')).filter((el) => el.tabIndex >= 0);
    expect(stops).toEqual([tabOf('sw'), within(report()).getByRole('button', { name: 'sw, first use' })]);
  });

  it('keeps one tab stop when classes appear, move, disappear, and return', () => {
    const cells = { cells: 1, zero: 0, one: 1, many: 0 };
    const view = (classes: string[]) => (
      <MatchReport
        entries={[]}
        counts={{ perClass: new Map(classes.map((cls) => [cls, cells])), perUse: new Map() }}
        onPick={() => {}}
      />
    );
    const { rerender } = render(view(['dev', 'sw']));
    fireEvent.click(tabOf('sw'));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    rerender(view(['dev', 'sw', 'lan']));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    rerender(view(['sw', 'lan', 'dev']));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    rerender(view(['lan', 'dev']));
    expect(active()).toBe('lan');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1]);
    rerender(view([]));
    expect(within(report()).queryAllByRole('tab')).toHaveLength(0);
    rerender(view(['dev', 'lan']));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1]);
  });

  it('shows each orphan label set in order and the separate overflow count', () => {
    const labels = Array.from({ length: 50 }, (_, i) => ({ job: `node-${i}`, site: 'demo' }));
    render(
      <MatchReport
        entries={[{ kind: 'orphan-series', refId: 'up', labels, more: 7 }]}
        counts={empty}
        onPick={() => {}}
      />
    );
    const sets = within(report()).getAllByText(/^\{job=/);
    expect(sets.map((el) => el.textContent)).toEqual(labels.map(({ job, site }) => `{job="${job}", site="${site}"}`));
    expect(within(report()).getByText('+7 more')).toBeTruthy();
  });

  it('shows each cell and its own series count for an ambiguous use', () => {
    render(
      <MatchReport
        entries={[
          {
            kind: 'many-series',
            cls: 'dev',
            use: 'classes.dev.status',
            cells: [
              { id: 'a', count: 2 },
              { id: 'b', count: 20 },
            ],
          },
        ]}
        counts={empty}
        onPick={() => {}}
      />
    );
    expect(within(report()).getByText('a: 2 series')).toBeTruthy();
    expect(within(report()).getByText('b: 20 series')).toBeTruthy();
  });

  it('puts the entries without a class in a group of their own', () => {
    const entries: ReportEntry[] = [
      { kind: 'yaml', line: 3, message: 'Map keys must be unique' },
      { kind: 'orphan-series', refId: 'up', labels: [{ job: 'x' }], more: 0 },
      { kind: 'unknown-class', cellIds: ['a'], bind: 'nope' },
    ];
    render(<MatchReport entries={entries} counts={empty} onPick={() => {}} />);
    const other = group('Not in a class');
    expect(within(other).getAllByRole('listitem')).toHaveLength(3);
  });

  it('gives each entry its YAML place and its cells', () => {
    expect(entryTarget({ kind: 'yaml', line: 3, message: 'x' })).toEqual({ line: 3, cells: [] });
    expect(entryTarget({ kind: 'no-series', cls: 'dev', use: 'classes.dev.status', cellIds: ['b'] })).toEqual({
      path: 'classes.dev.status',
      cells: ['b'],
    });
    expect(
      entryTarget({ kind: 'many-series', cls: 'dev', use: 'classes.dev.rows[0]', cells: [{ id: 'a', count: 2 }] })
    ).toEqual({ path: 'classes.dev.rows[0]', cells: ['a'] });
    expect(entryTarget({ kind: 'class-cycle', cls: 'sw.1' })).toEqual({ path: 'classes["sw.1"].extends', cells: [] });
    expect(entryTarget({ kind: 'unknown-override', cellId: 'gone' })).toEqual({ path: 'overrides.gone', cells: [] });
    expect(entryTarget({ kind: 'capacity-fallback', cls: 'lan', reason: 'r', cellIds: ['l1'] })).toEqual({
      path: 'classes.lan.capacity',
      cells: ['l1'],
    });
    expect(entryTarget({ kind: 'unused-field', cls: 'lan', field: 'up', cellIds: ['n1'] })).toEqual({
      path: 'classes.lan.up',
      cells: ['n1'],
    });
    expect(entryTarget({ kind: 'query-unavailable', refId: 'up', state: 'error', message: 'm' })).toEqual({
      cells: [],
    });
  });

  it('sends a pick for an entry and for a count row', () => {
    const onPick = vi.fn();
    const entries: ReportEntry[] = [{ kind: 'no-series', cls: 'dev', use: 'classes.dev.status', cellIds: ['b'] }];
    const perClass = new Map([['dev', { cells: 2, zero: 1, one: 1, many: 0 }]]);
    const perUse = new Map([['classes.dev.status', { zero: 1, one: 1, many: 0 }]]);
    render(<MatchReport entries={entries} counts={{ perClass, perUse }} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: '1 cell has no series' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'entry', path: 'classes.dev.status', cells: ['b'] });
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'status' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'path', path: 'classes.dev.status' });
    fireEvent.click(screen.getByRole('button', { name: 'dev, first use' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'path', path: 'classes.dev' });
  });

  it('shows one tab per class with the count of its entries, then the tab of the entries without a class', () => {
    const entries: ReportEntry[] = [
      { kind: 'no-series', cls: 'dev', use: 'classes.dev.status', cellIds: ['b'] },
      { kind: 'unknown-class', cellIds: ['a'], bind: 'nope' },
      { kind: 'orphan-series', refId: 'up', labels: [{ job: 'x' }], more: 0 },
    ];
    const perClass = new Map([
      ['dev', { cells: 2, zero: 1, one: 1, many: 0 }],
      ['sw', { cells: 1, zero: 0, one: 1, many: 0 }],
    ]);
    render(<MatchReport entries={entries} counts={{ perClass, perUse: new Map() }} onPick={() => {}} />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(tabs().map((t) => t.textContent)).toEqual(['dev1', 'sw', 'Not in a class2']);
    expect(active()).toBe('dev1');
    const panel = within(report()).getByRole('tabpanel');
    expect(panel.getAttribute('aria-label')).toBe('Class dev');
    expect(tabOf('dev').getAttribute('aria-controls')).toBe(panel.id);
    fireEvent.click(tabOf('Not in a class'));
    expect(within(within(report()).getByRole('tabpanel')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('moves between the tabs with the arrow keys, Home and End', () => {
    const perClass = new Map([
      ['dev', { cells: 2, zero: 1, one: 1, many: 0 }],
      ['sw', { cells: 1, zero: 0, one: 1, many: 0 }],
      ['lan', { cells: 1, zero: 0, one: 1, many: 0 }],
    ]);
    render(<MatchReport entries={[]} counts={{ perClass, perUse: new Map() }} onPick={() => {}} />);
    expect(active()).toBe('dev');
    act(() => tabOf('dev').focus());
    fireEvent.keyDown(tabOf('dev'), { key: 'ArrowRight' });
    expect(active()).toBe('sw');
    expect(document.activeElement).toBe(tabOf('sw'));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(tabOf('sw'), { key: 'End' });
    expect(active()).toBe('lan');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(tabOf('lan'), { key: 'ArrowRight' });
    expect(active()).toBe('dev');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(tabOf('dev'), { key: 'ArrowLeft' });
    expect(active()).toBe('lan');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(tabOf('lan'), { key: 'Home' });
    expect(active()).toBe('dev');
    expect(document.activeElement).toBe(tabOf('dev'));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it('opens the tab of each new follow request, also for the same class again', () => {
    const perClass = new Map([
      ['dev', { cells: 2, zero: 1, one: 1, many: 0 }],
      ['sw', { cells: 1, zero: 0, one: 1, many: 0 }],
    ]);
    const counts = { perClass, perUse: new Map() };
    const entries: ReportEntry[] = [{ kind: 'unknown-override', cellId: 'gone' }];
    const { rerender } = render(
      <MatchReport entries={entries} counts={counts} onPick={() => {}} follow={{ group: 'sw' }} />
    );
    expect(active()).toBe('sw');
    fireEvent.click(tabOf('dev'));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    rerender(<MatchReport entries={entries} counts={counts} onPick={() => {}} follow={{ group: 'sw' }} />);
    expect(active()).toBe('sw');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    // null: the tab of the entries without a class
    rerender(<MatchReport entries={entries} counts={counts} onPick={() => {}} follow={{ group: null }} />);
    expect(active()).toBe('Not in a class1');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    // a class with no tab keeps the tab
    rerender(<MatchReport entries={entries} counts={counts} onPick={() => {}} follow={{ group: 'nope' }} />);
    expect(active()).toBe('Not in a class1');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('an arrow key moves from the focused tab, also when it is not the open tab', () => {
    const perClass = new Map([
      ['dev', { cells: 2, zero: 1, one: 1, many: 0 }],
      ['sw', { cells: 1, zero: 0, one: 1, many: 0 }],
      ['lan', { cells: 1, zero: 0, one: 1, many: 0 }],
    ]);
    render(<MatchReport entries={[]} counts={{ perClass, perUse: new Map() }} onPick={() => {}} />);
    expect(active()).toBe('dev');
    act(() => tabOf('sw').focus());
    fireEvent.keyDown(tabOf('sw'), { key: 'ArrowRight' });
    expect(active()).toBe('lan');
  });

  it('opens the tab of a follow request when the class gets its tab later', () => {
    const dev = { cells: 2, zero: 1, one: 1, many: 0 };
    const before = { perClass: new Map([['dev', dev]]), perUse: new Map() };
    const after = {
      perClass: new Map([
        ['dev', dev],
        ['new', dev],
      ]),
      perUse: new Map(),
    };
    const follow = { group: 'new' };
    const { rerender } = render(<MatchReport entries={[]} counts={before} onPick={() => {}} />);
    rerender(<MatchReport entries={[]} counts={before} onPick={() => {}} follow={follow} />);
    expect(active()).toBe('dev');
    rerender(<MatchReport entries={[]} counts={after} onPick={() => {}} follow={follow} />);
    expect(active()).toBe('new');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0]);
  });
});

it('keeps unmeasured information after warnings, out of the tab count, and selects its links', () => {
  const onPick = vi.fn();
  render(
    <MatchReport
      entries={[
        { kind: 'unmeasured-link', cls: 'lan', attrs: ['key', 'port'], cellIds: ['l'] },
        { kind: 'end-ambiguous', cls: 'lan', cellIds: ['other'] },
      ]}
      counts={{ perClass: new Map(), perUse: new Map() }}
      onPick={onPick}
    />
  );
  expect(screen.getByRole('tab').textContent).toBe('lan1');
  const items = screen.getAllByRole('listitem');
  expect(items[0].textContent).toContain('both ends');
  fireEvent.click(within(items[1]).getAllByRole('button')[0]);
  expect(onPick).toHaveBeenCalledWith({ kind: 'entry', path: 'classes.lan', cells: ['l'] });
});

describe('MatchReport counts of identity', () => {
  const warning: ReportEntry = { kind: 'no-series', cls: 'dev', use: 'classes.dev.status', cellIds: ['b'] };
  const info: ReportEntry = { kind: 'unmeasured-link', cls: 'lan', attrs: ['key'], cellIds: ['l'] };
  const none = { cells: 1, zero: 0, one: 1, many: 0 };

  it('opens the first tab with a warning, not a class that has only the information entry', () => {
    const perClass = new Map([
      ['lan', none],
      ['dev', none],
    ]);
    render(<MatchReport entries={[info, warning]} counts={{ perClass, perUse: new Map() }} onPick={() => {}} />);
    expect(active()).toBe('dev1');
  });

  it('opens the first tab with the information entry when no class has a warning', () => {
    const perClass = new Map([
      ['dev', none],
      ['lan', none],
    ]);
    render(<MatchReport entries={[info]} counts={{ perClass, perUse: new Map() }} onPick={() => {}} />);
    expect(active()).toBe('lan');
  });

  it('shows the unmeasured links and the cells with an inherited value as their own numbers, only when not 0', () => {
    const perClass = new Map([
      ['lan', { ...none, unmeasured: 3, inherited: 1 }],
      ['dev', { ...none, unmeasured: 0, inherited: 0 }],
    ]);
    render(<MatchReport entries={[]} counts={{ perClass, perUse: new Map() }} onPick={() => {}} />);
    const lan = within(report()).getByRole('tabpanel');
    expect(within(lan).getByTestId('dmap-report-unmeasured').textContent).toBe('3 links have no measured end');
    expect(within(lan).getByTestId('dmap-report-inherited').textContent).toBe('1 cell reads an inherited value');
    fireEvent.click(tabOf('dev'));
    const dev = within(report()).getByRole('tabpanel');
    expect(within(dev).queryByTestId('dmap-report-unmeasured')).toBeNull();
    expect(within(dev).queryByTestId('dmap-report-inherited')).toBeNull();
  });
});
