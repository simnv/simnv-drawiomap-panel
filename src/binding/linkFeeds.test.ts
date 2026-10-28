import { describe, expect, it } from 'vitest';
import { linkFeeds } from './linkFeeds';

describe('linkFeeds (spec 3.8.2, D14)', () => {
  it('a→b takes up and b→a takes down when the cell has no at', () => {
    expect(linkFeeds(undefined, 'TX', 'RX')).toEqual({ a2b: 'TX', b2a: 'RX' });
  });

  it('at=source is the same as no at', () => {
    expect(linkFeeds('source', 'TX', 'RX')).toEqual({ a2b: 'TX', b2a: 'RX' });
  });

  it('at=target flips the feeds', () => {
    expect(linkFeeds('target', 'TX', 'RX')).toEqual({ a2b: 'RX', b2a: 'TX' });
  });
});
