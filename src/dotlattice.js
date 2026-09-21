// dotlattice — DOM renderer for the pixel dot-lattice time series.
// One SVG in measured pixels: columns of dots on a fixed grid, sides
// stacked away from a shared baseline, hue by group. The counting lives
// in lattice.js; this file only decides where things go and owns the DOM.
//
// Style lifted from servitor's DotLattice.svelte: dashed tick lines whose
// labels stack rows on collision, runs of dots on the baseline, a
// translucent highlight window, axis labels along the top, and a hover
// hit-target per column with a tooltip.

import { bucketize, quantumFor, stack, rowsFor, stackLabels, toMs, autoTicks, thinAxis } from './lattice.js';

export const DEFAULT_PALETTE = [
  '#7aa2f7', '#9ece6a', '#e0af68', '#f7768e',
  '#bb9af7', '#7dcfff', '#ff9e64', '#73daca',
];

const LABEL_PX = 6.1, SIG_PX = 5.2;   // ~px per char: tick label, signature
const AXIS_PX = 6.0;                  // ~px per char: axis label at 9px font
const ROW_H = 11;
const DIM = 'var(--dl-dim, #5c6370)';
const FAIL = 'var(--dl-fail, #f7768e)';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  const st = document.createElement('style');
  st.textContent = `
.dl-root { position: relative; }
.dl-root svg { display: block; overflow: visible; }
.dl-axis { fill: ${DIM}; font-size: 9px; letter-spacing: 0.06em; }
.dl-base { stroke: var(--dl-line, #3a3f4b); stroke-width: 1; }
.dl-highlight { fill: var(--dl-accent, #7aa2f7); opacity: 0.12; pointer-events: none; }
.dl-hit { fill: transparent; }
.dl-col:hover .dl-hit { fill: var(--dl-hover, #ffffff); fill-opacity: 0.07; }
.dl-dash { stroke: currentColor; stroke-width: 1; opacity: 0.8; stroke-dasharray: 2 3; }
.dl-tick text { fill: currentColor; font-size: 9px; letter-spacing: 0.06em; }
.dl-tick .sig { fill: ${DIM}; letter-spacing: 0; }
.dl-run { fill: currentColor; opacity: 0.85; }
`;
  document.head.appendChild(st);
  styleInjected = true;
}

function fmtStamp(ms) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(ms) {
  if (ms < 60000) return '<1m';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
function defaultTooltip(b, bucketMs) {
  const parts = [];
  for (const [g, sides] of Object.entries(b.groups)) {
    const n = Object.values(sides).reduce((a, v) => a + v, 0);
    parts.push(`${n} ${g}${n === 1 ? '' : 's'}`);
  }
  return `${fmtStamp(b.start)} +${fmtDur(bucketMs)}\n${parts.join(', ')}`;
}

export class DotLattice {
  // el: element or selector string.
  // opts (all optional):
  //   cell        grid pitch in px                       (8)
  //   dot         dot radius / half-size in px           (2.5)
  //   shape       'circle' | 'square'                    ('circle')
  //   maxRows     rows a side before a dot = N events    (12)
  //   gap         min px between tick labels             (10)
  //   span        {min, max} timestamps; default: data extent
  //   groups      group order + colors: [{name, color}] or {name: color};
  //               groups not listed get palette colors in first-seen order
  //   sides       {sideKey: 'up' | 'down'}               ({})
  //   sideOpacity {sideKey: 0..1}                        ({})
  //   ticks       [{t, label, sig?, color?, title?}]
  //   runs        [{start, end, color?, title?}]
  //   highlight   {from, to}
  //   axis        [{t, label}]
  //   autoAxis    'auto' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'off' —
  //               time-axis ticks generated for the current span (replaces axis)
  //   brush       true: drag-select a time range to zoom; fires onSelect
  //   onSelect     (view | null) => void — view is {from, to} in ms; null on
  //               reset (empty click / Escape / dblclick)
  //   tooltip     (bucket, bucketMs) => string
  //   label       aria-label                            ('dot lattice')
  //   onQuantum   called when the quantum changes
  constructor(el, opts = {}) {
    this.el = typeof el === 'string' ? document.querySelector(el) : el;
    if (!this.el) throw new Error('dotlattice: no target element');
    this.opts = { cell: 8, dot: 2.5, shape: 'circle', maxRows: 12, gap: 10, ...opts };
    this.events = [];
    this.quantum = 1;
    this.view = null;            // {from, to} zoom window, or null = full span
    injectStyle();
    this.el.classList.add('dl-root');
    this._ro = new ResizeObserver(() => this._render());
    this._ro.observe(this.el);
    this._bindBrush();
    this._render();
  }

  setData(events) { this.events = events ?? []; this._render(); return this; }
  setOptions(opts) { Object.assign(this.opts, opts); this._render(); return this; }
  setView(from, to) {                          // zoom programmatically; nulls reset
    if (from == null || to == null || !(toMs(to) > toMs(from))) { this.view = null; }
    else this.view = { min: toMs(from), max: toMs(to) };
    this._render();
    this.opts.onSelect?.(this.view ? { from: this.view.min, to: this.view.max } : null);
    return this;
  }
  destroy() { this._ro.disconnect(); this._unbindBrush(); this.el.innerHTML = ''; }

  _span() {
    if (this.opts.span) {
      return { min: toMs(this.opts.span.min), max: toMs(this.opts.span.max) };
    }
    let min = Infinity, max = -Infinity;
    for (const e of this.events) {
      const t = toMs(e.t);
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (min === Infinity) return null;
    return max === min ? { min, max: max + 1 } : { min, max };
  }

  // ---- brush: drag to select a time range, click empty / Esc / dblclick to reset
  _bindBrush() {
    if (!this.opts.brush) return;
    this._brush = {
      drag: null,                                        // {x0, x1, moved}
      onDown: (ev) => {
        const r = this.el.getBoundingClientRect();
        const x0 = ev.clientX - r.left;
        this._brush.drag = { x0, x1: x0, moved: false };
        this._brush.mv = (ev2) => {
          const x1 = Math.max(0, Math.min(r.width, ev2.clientX - r.left));
          const d = this._brush.drag;
          if (!d) return;
          if (Math.abs(x1 - d.x0) > 3) d.moved = true;
          d.x1 = x1;
          this._paintBrush();
        };
        this._brush.up = (ev2) => {
          const d = this._brush.drag;
          window.removeEventListener('pointermove', this._brush.mv);
          window.removeEventListener('pointerup', this._brush.up);
          this._brush.drag = null;
          this._brushOverlay && this._brushOverlay.remove();
          this._brushOverlay = null;
          if (!d) return;
          if (!d.moved) { this.setView(null, null); return; }   // plain click resets
          const a = Math.min(d.x0, d.x1), b = Math.max(d.x0, d.x1);
          if (b - a < 3) { this.setView(null, null); return; }
          const span = this._span();
          const view = this.view ?? span;
          if (!view) return;
          const t0 = view.min + (a / this.el.clientWidth) * (view.max - view.min);
          const t1 = view.min + (b / this.el.clientWidth) * (view.max - view.min);
          this.setView(t0, t1);
        };
        window.addEventListener('pointermove', this._brush.mv);
        window.addEventListener('pointerup', this._brush.up);
      },
      onKey: (ev) => {
        if (ev.key === 'Escape') this.setView(null, null);
      },
      onDbl: () => this.setView(null, null),
    };
    this.el.addEventListener('pointerdown', this._brush.onDown);
    this.el.addEventListener('keydown', this._brush.onKey);
    this.el.addEventListener('dblclick', this._brush.onDbl);
    this.el.style.cursor = 'crosshair';
    this.el.style.touchAction = 'none';             // let pointer events pan/zoom
  }
  _unbindBrush() {
    if (!this._brush) return;
    this.el.removeEventListener('pointerdown', this._brush.onDown);
    this.el.removeEventListener('keydown', this._brush.onKey);
    this.el.removeEventListener('dblclick', this._brush.onDbl);
  }
  _paintBrush() {
    const d = this._brush?.drag;
    if (!d) return;
    const a = Math.min(d.x0, d.x1), b = Math.max(d.x0, d.x1);
    if (!this._brushOverlay) {
      this._brushOverlay = document.createElement('div');
      this._brushOverlay.style.cssText =
        'position:absolute;top:0;bottom:0;pointer-events:none;' +
        'background:var(--dl-accent, #7aa2f7);opacity:0.15;';
      this.el.appendChild(this._brushOverlay);
    }
    this._brushOverlay.style.left = a + 'px';
    this._brushOverlay.style.width = (b - a) + 'px';
  }

  // Group order + colors: configured first (in given order), then any
  // group seen in the data, palette-assigned in first-seen order.
  _groups() {
    const order = [], colors = {};
    const add = (name, color) => {
      if (!order.includes(name)) order.push(name);
      if (color) colors[name] = color;
    };
    const g = this.opts.groups;
    if (Array.isArray(g)) {
      for (const it of g) typeof it === 'string' ? add(it) : add(it.name, it.color);
    } else if (g && typeof g === 'object') {
      for (const [name, color] of Object.entries(g)) add(name, color);
    }
    let p = 0;
    for (const e of this.events) {
      const name = e.group ?? 'default';
      if (!order.includes(name)) order.push(name);
      if (!colors[name]) colors[name] = DEFAULT_PALETTE[p++ % DEFAULT_PALETTE.length];
    }
    return { order, colors };
  }

  _dot(cx, cy, fill, opacity = 1) {
    const { dot, shape } = this.opts;
    if (shape === 'square') {
      return `<rect x="${cx - dot}" y="${cy - dot}" width="${dot * 2}" height="${dot * 2}" fill="${fill}" opacity="${opacity}"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="${dot}" fill="${fill}" opacity="${opacity}"/>`;
  }

  _render() {
    const o = this.opts;
    const width = this.el.clientWidth;
    const span = this._span();
    if (!width || !span) { this.el.innerHTML = ''; return; }
    const s = this.view ?? span;                  // effective drawing span
    const zoomed = !!this.view;

    const cols = Math.max(1, Math.floor(width / o.cell));
    const buckets = bucketize(this.events, s.min, s.max, cols);
    const q = quantumFor(buckets, o.maxRows);
    if (q !== this.quantum) { this.quantum = q; o.onQuantum?.(q); }
    const { order, colors } = this._groups();
    const dir = o.sides ?? {};
    const opa = o.sideOpacity ?? {};

    // rows per direction; a row is always reserved on both sides so the
    // baseline never sits on an edge, even for one-sided data
    const rows = { up: 1, down: 1 };
    for (const [side, n] of Object.entries(rowsFor(buckets, q, order))) {
      const d = dir[side] ?? 'up';
      rows[d] = Math.max(rows[d], n);
    }

    const bucketMs = (s.max - s.min) / cols;
    const W = s.max - s.min;
    const x = (ms) => ((Math.min(Math.max(ms, s.min), s.max) - s.min) / W) * width;
    const snap = (px) => Math.min(cols - 1, Math.floor(px / o.cell)) * o.cell + o.cell / 2;
    const colOf = (ms) => Math.min(cols - 1, Math.floor(x(ms) / o.cell));

    // axis labels: generated (autoAxis) or caller-supplied, then thinned so
    // they never overlap — an axis is one row, dense labels are dropped,
    // not re-rowed. When zoomed, the right edge is reserved for the range
    // readout drawn there.
    const zoomText = zoomed ? `${fmtStamp(s.min)} → ${fmtStamp(s.max)}` : '';
    const axisRight = zoomed
      ? Math.max(width - (zoomText.length * AXIS_PX + 8), 40)
      : width;
    const axis = thinAxis(
      (o.autoAxis && o.autoAxis !== 'off'
        ? autoTicks(s.min, s.max, bucketMs, o.autoAxis)
        : (o.axis ?? [])
      ).map((a) => ({ ...a, x: x(toMs(a.t)), w: String(a.label).length * AXIS_PX })),
      axisRight, 6
    );
    const TOP = (axis.length || zoomed) ? 14 : 2;
    const y0 = TOP + rows.up * o.cell;            // baseline
    const lowY = y0 + rows.down * o.cell;         // bottom of down dots

    // ticks: dashed annotation lines with collision-stacking labels
    const ticks = (o.ticks ?? [])
      .filter((tk) => !zoomed || (toMs(tk.t) >= s.min && toMs(tk.t) <= s.max))
      .slice().sort((a, b) => toMs(a.t) - toMs(b.t))
      .map((tk) => ({ ...tk, sig: tk.sig ?? '', cx: snap(x(toMs(tk.t))) }));
    const placed = stackLabels(
      ticks.map((it) => ({ ...it, w: String(it.label).length * LABEL_PX + String(it.sig).length * SIG_PX })),
      width, o.gap
    );
    const labelRows = placed.reduce((n, tk) => Math.max(n, tk.row + 1), 0);
    const labelY = lowY + 16;                     // first label baseline
    const height = placed.length ? labelY + (labelRows - 1) * ROW_H + 4 : lowY + 4;

    const parts = [];
    parts.push(`<svg width="${width}" height="${height}" role="img" aria-label="${esc(o.label ?? 'dot lattice')}">`);

    for (const a of axis) {
      parts.push(`<text class="dl-axis" x="${a.tx}" y="9"${a.anchor !== 'middle' ? ` text-anchor="${a.anchor}"` : ''}>${esc(a.label)}</text>`);
    }
    if (zoomed) parts.push(`<text class="dl-axis dl-zoom" x="${width}" y="9" text-anchor="end">${esc(zoomText)}</text>`);

    if (o.highlight) {
      const x1 = x(toMs(o.highlight.from)), x2 = x(toMs(o.highlight.to));
      parts.push(`<rect class="dl-highlight" x="${x1}" y="${TOP}" width="${Math.max(x2 - x1, 2)}" height="${lowY - TOP}"/>`);
    }

    // every dash painted before every label, so a dash running down to a
    // lower row passes under the text above it, never through it
    for (const tk of placed) {
      parts.push(`<line class="dl-dash" style="color:${tk.color ?? DIM}" x1="${tk.cx}" x2="${tk.cx}" y1="${TOP}" y2="${labelY + tk.row * ROW_H - 9}"/>`);
    }
    for (const tk of placed) {
      const title = tk.title ? `<title>${esc(tk.title)}</title>` : '';
      parts.push(`<g class="dl-tick" style="color:${tk.color ?? DIM}"><text x="${tk.tx}" y="${labelY + tk.row * ROW_H}" text-anchor="${tk.anchor}">${esc(tk.label)}${tk.sig ? `<tspan class="sig" dx="3">${esc(tk.sig)}</tspan>` : ''}</text>${title}</g>`);
    }

    // baseline, with runs of dots on it
    parts.push(`<line class="dl-base" x1="0" x2="${width}" y1="${y0}" y2="${y0}"/>`);
    for (const run of o.runs ?? []) {
      const c0 = colOf(toMs(run.start)), c1 = colOf(toMs(run.end));
      let dots = '';
      for (let i = c0; i <= c1; i++) dots += this._dot(i * o.cell + o.cell / 2, y0, run.color ?? FAIL);
      const title = run.title ? `<title>${esc(run.title)}</title>` : '';
      parts.push(`<g class="dl-run" style="color:${run.color ?? FAIL}">${dots}${title}</g>`);
    }

    // the lattice: one dot per event (or per quantum), stacked outward
    const tooltip = o.tooltip ?? defaultTooltip;
    for (const b of buckets) {
      const total = Object.values(b.sides).reduce((n, v) => n + v, 0);
      if (!total) continue;
      const cx = b.i * o.cell + o.cell / 2;
      let dots = '';
      for (const s of Object.keys(b.sides)) {
        const d = dir[s] ?? 'up';
        const opacity = opa[s] ?? 1;
        stack(b, s, q, order).forEach((dt, i) => {
          const cy = d === 'up'
            ? y0 - 1 - (i * o.cell + o.cell / 2)
            : y0 + 1 + (i * o.cell + o.cell / 2);
          dots += this._dot(cx, cy, colors[dt.group], opacity);
        });
      }
      parts.push(`<g class="dl-col">${dots}<rect class="dl-hit" x="${b.i * o.cell}" y="${TOP}" width="${o.cell}" height="${lowY - TOP}"><title>${esc(tooltip(b, bucketMs))}</title></rect></g>`);
    }

    parts.push('</svg>');
    this.el.innerHTML = parts.join('');
  }
}
