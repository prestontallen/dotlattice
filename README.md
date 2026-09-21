# dotlattice

Pixel-style dot-lattice time series chart. One SVG, zero dependencies.
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
| `runs` | — | baseline runs: `[{start, end, color?, title?}]` |
| `highlight` | — | window: `{from, to}` |
| `axis` | — | top labels: `[{t, label}]` |
| `autoAxis` | — | 'auto' or 'minute'/'hour'/'day'/'week'/'month'/'off' |
| `hour12` | false | true for AM/PM time labels; default 24-hour clock |
| `brush` | false | drag-select to zoom |
| `onSelect` | — | `(view or null) => void`, view is `{from, to}` |
| `onQuantum` | — | `(n) => void` when the quantum changes |
| `tooltip` | default | `(bucket, bucketMs) => string` |

Layout lives in `src/lattice.js` as pure functions (`bucketize`,
`quantumFor`, `stack`, `autoTicks`, `thinAxis`, ...) if you want to
render somewhere other than the DOM.

Colors fall back to the `DEFAULT_PALETTE`; the chrome reads CSS vars
(`--dl-dim`, `--dl-line`, `--dl-accent`, `--dl-fail`, `--dl-hover`)
with dark-theme defaults.

## Test / demo

```
npm test          # node --test, 11 tests
npm run demo      # serves demo/ on :4173
```

The demo page exercises grouping, density + quantum, overlays, and
brush zoom with a rollup selector.

---

One dot per event, stacked from the baseline like a tide gauge.
