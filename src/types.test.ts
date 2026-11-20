import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, migrateOptions, withDefaults, type Options } from './types';

describe('withDefaults', () => {
  it('loads old saved options without summary, hover and legend', () => {
    // An older version saved only these keys, and some removed ones.
    const saved = {
      diagram: { xml: '<mxfile/>', svg: '<svg/>', hash: 'h', updatedAt: '' },
      zoom: { mode: 'original', percent: 100, wheel: true, pan: false },
      linkWidth: { min: 1, max: 6 },
      editorUrl: 'https://embed.diagrams.net',
      rules: [],
    } as Options;
    const opts = withDefaults(saved);
    expect(opts.summary).toEqual(DEFAULT_OPTIONS.summary);
    expect(opts.hover).toEqual(DEFAULT_OPTIONS.hover);
    expect(opts.legend).toEqual(DEFAULT_OPTIONS.legend);
    // the saved groups win; a key the old version did not save takes its default
    expect(opts.zoom).toEqual({ mode: 'original', percent: 100, wheel: true, pan: false, align: 'top' });
    expect(opts.linkWidth).toEqual({ ...DEFAULT_OPTIONS.linkWidth, min: 1, max: 6, mode: 'load' });
    // other keys go through unchanged
    expect(opts.diagram).toBe(saved.diagram);
    expect(opts.rules).toBe(saved.rules);
    expect((opts as unknown as Record<string, unknown>).editorUrl).toBe('https://embed.diagrams.net');
  });

  it('fills the missing keys of a saved group and keeps the saved ones', () => {
    const opts = withDefaults({
      zoom: DEFAULT_OPTIONS.zoom,
      linkWidth: DEFAULT_OPTIONS.linkWidth,
      legend: { corner: 'top-left' } as Options['legend'],
      summary: { maxRows: 0 },
      hover: { kinds: ['canvas'] },
    });
    expect(opts.legend).toEqual({ ...DEFAULT_OPTIONS.legend, corner: 'top-left' });
    expect(opts.summary.maxRows).toBe(0);
    expect(opts.hover.kinds).toEqual(['canvas']);
    // the hover focus is on unless a saved panel turns it off
    expect(opts.hover.focus).toBe('on');
    // a panel saved before the Shift modes: true is on, false is off
    expect(withDefaults({ hover: { kinds: ['link'], focus: false } } as Options).hover.focus).toBe('off');
    expect(withDefaults({ hover: { kinds: ['link'], focus: true } } as Options).hover.focus).toBe('on');
    expect(withDefaults({ hover: { kinds: ['link'], focus: 'shift' } } as Options).hover.focus).toBe('shift');
    expect(migrateOptions({ hover: { kinds: ['link'], focus: false } } as Options).hover).toEqual({
      kinds: ['link'],
      focus: 'off',
    });
    const saved = { hover: { kinds: ['link'], focus: 'shift' } } as Options;
    expect(migrateOptions(saved)).toBe(saved);
  });

  it('loads saved options with no zoom and no link width', () => {
    const opts = withDefaults({} as Options);
    expect(opts.zoom).toEqual(DEFAULT_OPTIONS.zoom);
    expect(opts.linkWidth).toEqual(DEFAULT_OPTIONS.linkWidth);
  });
});
