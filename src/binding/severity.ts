import type { GrafanaTheme2 } from '@grafana/data';
import { colorChannels } from './color';

/**
 * The severity of a displayed value (spec 3.4). It decides only three things: the worst of N series, the status band
 * and the legend. The cell paints the exact colour of the value.
 */
export type Severity = 'down' | 'critical' | 'warning' | 'normal';

/** The hues of the Grafana palette that are not normal. */
const HUE_SEVERITY: Partial<Record<string, Severity>> = { red: 'critical', orange: 'warning', yellow: 'warning' };

interface Shade {
  rgb: [number, number, number];
  severity: Severity;
}

const shadeTables = new WeakMap<GrafanaTheme2, Shade[]>();

/** Each shade of each named hue of the theme, with the severity of its hue. Built once per theme. */
function shadesOf(theme: GrafanaTheme2): Shade[] {
  let shades = shadeTables.get(theme);
  if (!shades) {
    shades = theme.visualization.hues.flatMap((hue) =>
      hue.shades.flatMap((shade) => {
        const c = colorChannels(shade.color);
        return c ? [{ rgb: [c[0], c[1], c[2]] as Shade['rgb'], severity: HUE_SEVERITY[hue.name] ?? 'normal' }] : [];
      })
    );
    shadeTables.set(theme, shades);
  }
  return shades;
}

/**
 * The severity of a value display `{text, color}`. A text `down` (any case) gives `down`. Else the colour gives it:
 * a named colour or a resolved colour (hex, rgb) goes to the nearest shade of the named hues of the theme, and its
 * hue gives the severity: red is critical, orange and yellow are warning, the others are normal. A transparent colour
 * or a colour that does not parse is normal. The parse reads hex, `rgb()` and `hsl()` with commas, Grafana colour
 * names and CSS colour names: the forms that the display processor of Grafana gives.
 */
export function severityOf(display: { text: string; color: string }, theme: GrafanaTheme2): Severity {
  if (display.text.toLowerCase() === 'down') {
    return 'down';
  }
  const c = display.color ? colorChannels(theme.visualization.getColorByName(display.color)) : undefined;
  if (!c || c[3] === 0) {
    return 'normal';
  }
  let severity: Severity = 'normal';
  let nearest = Infinity;
  for (const shade of shadesOf(theme)) {
    const d = (shade.rgb[0] - c[0]) ** 2 + (shade.rgb[1] - c[1]) ** 2 + (shade.rgb[2] - c[2]) ** 2;
    if (d < nearest) {
      nearest = d;
      severity = shade.severity;
    }
  }
  return severity;
}
