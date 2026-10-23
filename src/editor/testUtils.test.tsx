import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buttonNamed, editorField } from './testUtils';

describe('test lookups keep the semantics of testing-library', () => {
  it('does not match a hidden element on its aria-label', () => {
    render(
      <div>
        <input aria-label="Field" hidden />
        <input aria-label="Field" data-testid="visible" />
      </div>
    );
    expect(editorField('Field').getAttribute('data-testid')).toBe('visible');
  });
  it('does not match an element that has aria-labelledby on its aria-label', () => {
    render(
      <div>
        <span id="name">Other name</span>
        <input aria-label="Field" aria-labelledby="name" />
        <input aria-label="Field" data-testid="plain" />
      </div>
    );
    expect(editorField('Field').getAttribute('data-testid')).toBe('plain');
  });
  it('takes the full query when a <label> gives the same name', () => {
    render(
      <div>
        <label htmlFor="a">Field</label>
        <input id="a" data-testid="labelled" />
        <input aria-label="Field" data-testid="aria" />
      </div>
    );
    // two elements have the name: the full query reports the ambiguity, as before
    expect(() => editorField('Field')).toThrow(/multiple/i);
  });
  it('finds a button by text, and skips a hidden duplicate', () => {
    render(
      <div>
        <button hidden>Save</button>
        <button data-testid="real">Save</button>
      </div>
    );
    expect(buttonNamed('Save').getAttribute('data-testid')).toBe('real');
  });
  it('skips an element that a <style> rule hides, on itself or on an ancestor', () => {
    render(
      <div>
        <style>{'.gone { display: none } .invisible { visibility: hidden }'}</style>
        <div className="gone">
          <input aria-label="Field" />
        </div>
        <input aria-label="Field" className="invisible" />
        <input aria-label="Field" data-testid="shown" />
        <button className="gone">Save</button>
        <button data-testid="real">Save</button>
      </div>
    );
    expect(editorField('Field').getAttribute('data-testid')).toBe('shown');
    expect(buttonNamed('Save').getAttribute('data-testid')).toBe('real');
  });
  it('takes the full query when a <label> also names a button', () => {
    render(
      <div>
        <label htmlFor="b">Run</label>
        <button id="b">Go</button>
        <button>Run</button>
      </div>
    );
    // the label names the first button and the text names the second: the full query reports both
    expect(() => buttonNamed('Run')).toThrow(/multiple/i);
    render(
      <label>
        Wrapped
        <button>Press</button>
      </label>
    );
    expect(() => buttonNamed('Wrapped')).not.toThrow();
  });
});
