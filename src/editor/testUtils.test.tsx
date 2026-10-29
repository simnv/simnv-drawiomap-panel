import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buttonNamed } from './testUtils';

describe('test lookups keep the semantics of testing-library', () => {
  it('finds a button by text, and skips a hidden duplicate', () => {
    render(
      <div>
        <button hidden>Save</button>
        <button data-testid="real">Save</button>
      </div>
    );
    expect(buttonNamed('Save').getAttribute('data-testid')).toBe('real');
  });
  it('skips a button that a <style> rule hides, on itself or on an ancestor', () => {
    render(
      <div>
        <style>{'.gone { display: none } .invisible { visibility: hidden }'}</style>
        <div className="gone">
          <button>Save</button>
        </div>
        <button className="invisible">Save</button>
        <button className="gone">Save</button>
        <button data-testid="real">Save</button>
      </div>
    );
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
