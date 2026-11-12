import type { APIRequestContext } from '@playwright/test';

/** The default time range of the demo dashboard, in seconds. */
const RANGE_S = 15 * 60;
/** The window of `rate(...[1m])` in the demo queries, in seconds. */
const RATE_WINDOW_S = 60;

const clock = (seconds: number) => new Date(seconds * 1000).toTimeString().slice(0, 8);

/**
 * Finds a stall of metrics-gen in the default range of the demo dashboard. It returns a sentence that tells the stall,
 * or '' when the samples of the counter `selector` have no stall.
 *
 * metrics-gen writes a sample every 5 s. When the machine sleeps or stalls, the samples have a hole. When the hole is
 * as long as the rate window, VictoriaMetrics returns `rate()` = 0 for the first steps of the hole. The panel draws
 * that value on the zero line, as it must. The chart of a constant demo series is then not flat, until the hole leaves
 * the time range (docs/acceptance.md, "An e2e run needs 15 minutes of data with no gap").
 */
export async function demoSeriesStall(request: APIRequestContext, selector: string): Promise<string> {
  // the zeros come after the last sample before the hole: look that much further back than the range
  const params = new URLSearchParams({ query: `${selector}[${RANGE_S + 2 * RATE_WINDOW_S}s]` });
  const response = await request.get(`/api/datasources/proxy/uid/victoriametrics/api/v1/query?${params}`);
  if (!response.ok()) {
    return `the datasource did not answer the query for ${selector} (HTTP ${response.status()})`;
  }
  const body = await response.json();
  const times: number[] = (body.data.result[0]?.values ?? []).map((sample: [number, string]) => sample[0]);
  for (let i = times.length - 1; i > 0; i--) {
    if (times[i] - times[i - 1] >= RATE_WINDOW_S) {
      return (
        `metrics-gen wrote no sample of ${selector} from ${clock(times[i - 1])} to ${clock(times[i])} ` +
        `(a sleep or a stall of the machine). Until about ${clock(times[i - 1] + 2 * RATE_WINDOW_S + RANGE_S)} the ` +
        `default ` +
        `range of the demo dashboard has rate() = 0 at that hole, and the chart of this series is not flat. ` +
        `This is not a fault of the panel: run the test again after that time.`
      );
    }
  }
  return '';
}
