import { describe, expect, it } from 'vitest';
import { defaultUrlTitle } from './links';

describe('defaultUrlTitle', () => {
  it('names Grafana dashboard paths "Open dashboard", other urls "Open <card title>"', () => {
    for (const u of [
      '/d/abc',
      '/d/abc/slug?var-x=1',
      '/grafana/d/abc/slug',
      'd/abc',
      'https://g.example/d/abc#p',
      '//g.example/sub/d/abc',
    ]) {
      expect(defaultUrlTitle(u, 'Host')).toBe('Open dashboard');
    }
    for (const u of [
      '/d/',
      '/dashboards',
      '/explore?x=/d/abc',
      'https://d/x',
      'https://example.com/docs/d',
      '/x#/d/a',
    ]) {
      expect(defaultUrlTitle(u, 'Host')).toBe('Open Host');
    }
  });
});
