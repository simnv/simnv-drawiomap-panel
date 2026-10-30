import { dateTimeFormat, dateTimeFormatTimeAgo, getTimeZone } from '@grafana/data';

/**
 * The format of the last data timestamp: the full date with the year, the clock time and the UTC offset. An offset
 * is clear in all zones; an abbreviation is not. The explicit format also skips the locale format of Grafana, which
 * can drop the year.
 */
const FORMAT = 'YYYY-MM-DD HH:mm:ss Z';

/** The text of the last data timestamp in the dashboard time zone. The offset is the offset at `time`. */
export function lastDataText(time: number, timeZone: string): string {
  return dateTimeFormat(time, { timeZone, format: FORMAT });
}

/** The name of the dashboard time zone: "UTC", the IANA name of the browser zone, or the IANA name of the zone. */
export function zoneName(timeZone: string): string {
  const zone = getTimeZone({ timeZone });
  if (zone === 'utc') {
    return 'UTC';
  }
  if (zone === 'browser' || zone === '') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return zone;
}

/** The tooltip of the last data timestamp. The age is from the current time: compute it when the tooltip opens. */
export function lastDataTooltip(time: number, timeZone: string): string {
  return `Last data timestamp: ${lastDataText(time, timeZone)} (${zoneName(timeZone)}, ${dateTimeFormatTimeAgo(time, { timeZone })})`;
}
