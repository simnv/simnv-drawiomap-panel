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

const { SplitEditor } = await import('./SplitEditor');
const { entryTarget, MatchReport } = await import('./MatchReport');

const report = () => screen.getByTestId('dmap-match-report');
const group = (name: string) => within(report()).getByRole('region', { name });
/** The cells of a count row: cells, 0 series, 1 series, more. The first column is the button of the row. */
const counts = (scope: HTMLElement, label: string) =>
  Array.from(within(scope).getByRole('button', { name: label }).closest('tr')!.querySelectorAll('td')).map(
    (td) => td.textContent
  );
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
    expect(counts(dev, 'classes.dev.status')).toEqual(['', '1', '1', '0']);
    expect(within(dev).getByRole('button', { name: 'classes.dev.status: 1 cells have no series' })).toBeTruthy();
    const sw = group('Class sw');
    expect(counts(sw, 'sw, first use')).toEqual(['1', '0', '1', '0']);
    expect(within(sw).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('follows an edit that changes the result', () => {
    render(<SplitEditor {...editorProps()} />);
    // `dev` now selects by a label that no series has
    type(fake.text.replace('key: job', 'key: host'));
    expect(counts(group('Class dev'), 'dev, first use')).toEqual(['2', '2', '0', '0']);
    expect(within(group('Class dev')).getByRole('button', { name: 'classes.dev.status: 2 cells have no series' }));
    // a YAML error is an entry of its own, and the counts stay at the last valid draft
    type('version: 4\nclasses: [\n');
    expect(within(report()).getByRole('button', { name: /^line \d+: / })).toBeTruthy();
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
      name: 'classes.dev.arrow: not used on 2 cells that are not edges',
    });
    fireEvent.click(entry);
    expect(fake.editor.setPosition).toHaveBeenLastCalledWith(positionOf('arrow: none'));
    expect(lit()).toEqual(['a', 'b']);
  });

  it('a click on an entry highlights its cells and moves the cursor to its path', () => {
    render(<SplitEditor {...editorProps()} />);
    fireEvent.click(within(group('Class dev')).getByRole('button', { name: /cells have no series/ }));
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
    fireEvent.click(within(group('Class dev')).getByRole('button', { name: 'classes.dev.status' }));
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
    fireEvent.click(within(group('Class dev')).getByRole('button', { name: /cells have no series/ }));
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
    fireEvent.click(within(report()).getByRole('button', { name: /unknown class unknown/ }));
    expect(lit()).toEqual(['a']);
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(['a']);
    expect(fake.editor.setPosition).not.toHaveBeenCalled();
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
  });

  it('a click on an entry for a class with no cells clears the previous highlight', () => {
    const config = { ...CONFIG, classes: { ...CONFIG.classes, spare: { match: { key: 'job' }, status: 'up' } } };
    render(<SplitEditor {...editorProps({ options: { ...editorProps().options, config } })} />);
    act(() => fake.moveTo(fake.text.indexOf('dev:')));
    act(() => vi.advanceTimersByTime(150));
    expect(lit()).toEqual(['a', 'b']);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
    fireEvent.click(within(group('Class spare')).getByRole('button', { name: /no cell binds this class/ }));
    expect(fake.editor.setPosition).toHaveBeenCalledWith(positionOf('spare:'));
    expect(lit()).toEqual([]);
    expect(zoom.fitCells).toHaveBeenCalledTimes(1);
  });
});

describe('MatchReport', () => {
  const empty = { perClass: new Map(), perUse: new Map() };

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
    const other = within(report()).getByRole('region', { name: 'Not in a class' });
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
    fireEvent.click(screen.getByRole('button', { name: 'classes.dev.status: 1 cells have no series' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'entry', path: 'classes.dev.status', cells: ['b'] });
    fireEvent.click(screen.getByRole('button', { name: 'classes.dev.status' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'path', path: 'classes.dev.status' });
    fireEvent.click(screen.getByRole('button', { name: 'dev, first use' }));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'path', path: 'classes.dev' });
  });
});
