# dotlattice

Pixel-style dot-lattice time series chart, and lanes of bars to go under
it. Zero dependencies.
The look is lifted from servitor's DotLattice: columns of dots on a
fixed grid, stacked outward from a baseline, hue by group — a time
series drawn in counted pixels rather than lines.

## Model

An event is `{ t, group, side }` — `t` is a timestamp (ms, Date, or
parseable string), `group` picks the series (color + stacking order,
baseline outward), `side` picks which side of the baseline it stacks
on. When a column would exceed `maxRows` dots, one dot stands for N
events (the quantum) and the count stays honest.

## Usage

```js
import { DotLattice } from './src/dotlattice.js';

const chart = new DotLattice('#chart', {
  groups: { commits: '#7dcfff', reviews: '#e0af68' },
  brush: true,        // drag to zoom
  autoAxis: 'auto',   // tick unit picked from the zoom level
});
chart.setData(events);            // [{t, group, side?}]
chart.setView(from, to);          // programmatic zoom; nulls reset
chart.setOptions({ shape: 'square' });
chart.destroy();
```

Not published to npm — import the module from this repo.

## Options

| option | default | |
|---|---|---|
| `cell` | 8 | grid pitch, px |
| `dot` | 2.5 | dot radius / half-size, px |
| `shape` | 'circle' | 'circle' or 'square' |
| `maxRows` | 12 | rows a side before quantum kicks in |
| `span` | data extent | `{min, max}` |
| `groups` | palette | order + colors, `[{name, color}]` or `{name: color}` |
| `sides` | all up | `{sideKey: 'up' or 'down'}` |
| `sideOpacity` | 1 | `{sideKey: 0..1}` |
| `ticks` | — | milestone lines: `[{t, label, sig?, color?, title?}]` |
| `tickLabels` | 'always' | 'hover': one marker per column under the plot; dash and labels appear while hovered |
| `maxLabelRows` | 4 | hover mode: label rows reserved under the plot; a taller column overflows while hovered |
| `runs` | — | baseline runs: `[{start, end, color?, title?}]` |
| `highlight` | — | window: `{from, to}` |
| `axis` | — | top labels: `[{t, label}]` |
| `autoAxis` | — | 'auto' or 'minute'/'hour'/'day'/'week'/'month'/'off' |
| `hour12` | false | true for AM/PM time labels; default 24-hour clock |
| `brush` | false | drag-select to zoom |
| `onSelect` | — | `(view or null) => void`, view is `{from, to}` |
| `onQuantum` | — | `(n) => void` when the quantum changes |
| `tooltip` | default | `(bucket, bucketMs) => string` |

Every tick label is a `<g class="dl-tick" data-index="N">` where N is the
tick's position in time order, so a click handler can map back to the
tick it was given without trusting DOM order. In hover mode the ticks
of one column share a `<g class="dl-tickcol">`: a `.dl-tickmark` square
(its `<title>` lists the column), the dash and the labels, which stack
straight down. Twenty gates in a week then cost one marker strip, not
twenty label rows.

## Lanes

Rows of bars over one span — one lane per row, each bar a stretch of one
kind from `start` to `end`, clipped to the span. The same pitch and axis
code as the lattice, so a lattice above and lanes below read as one
instrument. Labels need ellipsis and a real button, so this one is not
one SVG: an axis strip, then HTML rows with a small SVG each.

```js
import { Lanes } from './src/dotlattice.js';

const lanes = new Lanes('#flow', {
  span: { min, max },
  kinds: { building: '#7aa2f7', blocked: { color: '#f7768e', hatch: '#5a2a33' } },
  axis: [{ t, label }],          // or autoAxis: 'auto'
  onLabel: (lane) => open(lane.id),
});
lanes.setData([{ id, label, title?, bars: [{ start, end, kind, title? }] }]);
```

| option | default | |
|---|---|---|
| `span` | data extent | `{min, max}` |
| `cell` | 8 | ruling pitch, px |
| `rowH` | 9 | bar height, px |
| `gap` | 3 | px between rows |
| `labelWidth` | 150 | label column, px |
| `labelGap` | 10 | px between label and bars |
| `kinds` | palette | `{name: color}` or `{name: {color, hatch?}}`; hatch is the second colour of a diagonal hatch, `true` for the dim colour |
| `axis` / `autoAxis` / `hour12` | — | as for the lattice, drawn in a strip above the rows |
| `highlight` | — | `{from, to}` across every row |
| `onLabel` | — | `(lane, event) => void` when a label is clicked |
| `tooltip` | kind · duration | `(bar, lane) => string`; a bar's own `title` wins |

A bar entirely outside the span is dropped; one that straddles an edge is
clipped. A lane with no visible bars keeps its row.

Layout lives in `src/lattice.js` as pure functions (`bucketize`,
`quantumFor`, `stack`, `autoTicks`, `thinAxis`, `laneBars`, ...) if you
want to render somewhere other than the DOM.

Colors fall back to the `DEFAULT_PALETTE`; the chrome reads CSS vars
(`--dl-dim`, `--dl-line`, `--dl-accent`, `--dl-fail`, `--dl-hover`)
with dark-theme defaults.

## Test / demo

```
npm test          # node --test, 18 tests
npm run demo      # serves demo/ on :4173
```

The demo page exercises grouping, density + quantum, overlays, brush
zoom with a rollup selector, ticks on hover, and lanes under a lattice.

---

One dot per event, stacked from the baseline like a tide gauge.
