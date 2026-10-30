import { describe, expect, it } from 'vitest';
import { lastDataText, lastDataTooltip, zoneName } from './lastData';

// 2026-07-01 12:00:05 UTC (summer) and 2026-01-15 12:00:05 UTC (winter)
const SUMMER = Date.UTC(2026, 6, 1, 12, 0, 5);
const WINTER = Date.UTC(2026, 0, 15, 12, 0, 5);

describe('lastDataText', () => {
  it('gives the full date, the clock time and the UTC offset in the dashboard time zone', () => {
    expect(lastDataText(SUMMER, 'utc')).toBe('2026-07-01 12:00:05 +00:00');
    expect(lastDataText(SUMMER, 'Asia/Tokyo')).toBe('2026-07-01 21:00:05 +09:00');
  });

  it('takes the offset at the sample instant, not at the current time', () => {
    expect(lastDataText(SUMMER, 'Europe/Berlin')).toBe('2026-07-01 14:00:05 +02:00');
    expect(lastDataText(WINTER, 'Europe/Berlin')).toBe('2026-01-15 13:00:05 +01:00');
    expect(lastDataText(SUMMER, 'America/New_York')).toBe('2026-07-01 08:00:05 -04:00');
    expect(lastDataText(WINTER, 'America/New_York')).toBe('2026-01-15 07:00:05 -05:00');
  });

  it('uses the browser zone for "browser"', () => {
    const local = new Date(SUMMER);
    const pad = (n: number) => String(n).padStart(2, '0');
    const offset = -local.getTimezoneOffset();
    const sign = offset < 0 ? '-' : '+';
    const expected =
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ` +
      `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())} ` +
      `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    expect(lastDataText(SUMMER, 'browser')).toBe(expected);
  });
});

describe('zoneName', () => {
  it('names the zone of the tooltip', () => {
    expect(zoneName('utc')).toBe('UTC');
    expect(zoneName('Asia/Tokyo')).toBe('Asia/Tokyo');
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(zoneName('browser')).toBe(browser);
    // an empty zone is the Grafana default: the browser zone when nothing else is set
    expect(zoneName('')).toBe(browser);
  });
});

describe('lastDataTooltip', () => {
  it('says that the text is the last data timestamp, with the zone name and the age', () => {
    const now = Date.now();
    const text = lastDataTooltip(now - 5 * 60 * 1000, 'Asia/Tokyo');
    expect(text).toMatch(
      /^Last data timestamp: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \+09:00 \(Asia\/Tokyo, 5 minutes ago\)$/
    );
    expect(lastDataTooltip(SUMMER, 'utc')).toMatch(
      /^Last data timestamp: 2026-07-01 12:00:05 \+00:00 \(UTC, .+ ago\)$/
    );
  });
});
