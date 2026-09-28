// Lanes — rows of bars over one time span: one lane per row, each bar a
// stretch of one kind (a phase, a state) from start to end, clipped to
// the span. A sibling of DotLattice on the same pitch and the same axis
// code, so a lattice above and lanes below read as one instrument.
//
// Unlike the lattice this is not one SVG: a lane label needs ellipsis
// and a real button, which SVG text cannot give, so a Lanes chart is an
// axis strip and then HTML rows, each with its own small SVG. The
// counting-free layout (clipping to fractions) lives in lattice.js.

import { toMs, autoTicks, thinAxis, laneBars, fmtDur, DEFAULT_PALETTE } from './lattice.js';

const AXIS_PX = 6.0;                  // ~px per char: axis label at 9px font
const DIM = 'var(--dl-dim, #5c6370)';
const LINE = 'var(--dl-line, #3a3f4b)';
let nextId = 0;

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
.dl-lanes { position: relative; }
.dl-lanes svg { display: block; overflow: visible; }
.dl-lanes-defs { position: absolute; width: 0; height: 0; }
.dl-lanes-axis { fill: ${DIM}; font-size: 9px; letter-spacing: 0.06em; }
.dl-lane { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dl-lane-label {
  flex: none; text-align: left; font: inherit; font-size: 11px; line-height: 1.2;
  color: inherit; background: none; border: 0; padding: 0; min-height: 0; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
}
.dl-lane-label:hover { color: var(--dl-accent, #7aa2f7); }
.dl-lane svg { flex: none; }
.dl-bar { shape-rendering: crispEdges; }
.dl-lanes .dl-highlight { fill: var(--dl-accent, #7aa2f7); opacity: 0.12; pointer-events: none; }
`;
  document.head.appendChild(st);
  styleInjected = true;
}

export class Lanes {
  // el: element or selector string.
  // opts (all optional):
  //   span        {min, max} timestamps; default: data extent
  //   cell        ruling pitch in px, the lattice's grid       (8)
  //   rowH        bar height in px                            (9)
  //   gap         px between rows                             (3)
  //   labelWidth  px for the label column                     (150)
  //   labelGap    px between label and bars                   (10)
  //   kinds       {name: color} or {name: {color, hatch?}}; hatch is the
  //               second colour of a diagonal hatch (true = the dim colour);
  //               kinds not listed get palette colours in first-seen order
  //   axis        [{t, label}] drawn in a strip above the rows
  //   autoAxis    'auto' | 'minute' | ... | 'off' (replaces axis)
  //   hour12      true for AM/PM time labels
  //   highlight   {from, to}: a translucent window across every row
  //   onLabel     (lane, event) => void when a label is clicked
  //   tooltip     (bar, lane) => string; default "kind · duration"
  //   label       aria-label for each row's SVG               (lane.label)
  constructor(el, opts = {}) {
    this.el = typeof el === 'string' ? document.querySelector(el) : el;
    if (!this.el) throw new Error('dotlattice: no target element');
    this.opts = { cell: 8, rowH: 9, gap: 3, labelWidth: 150, labelGap: 10, hour12: false, ...opts };
    this.lanes = [];
    this._id = nextId++;
    injectStyle();
    this.el.classList.add('dl-lanes');
    this._onClick = (ev) => {
      const b = ev.target?.closest?.('.dl-lane-label');
      if (!b) return;
      const lane = this.lanes[Number(b.dataset.i)];
      if (lane) this.opts.onLabel?.(lane, ev);
    };
    this.el.addEventListener?.('click', this._onClick);
    this._ro = new ResizeObserver(() => this._render());
    this._ro.observe(this.el);
    this._render();
  }

  // lanes: [{id?, label, title?, bars: [{start, end, kind, title?}]}]
  setData(lanes) { this.lanes = lanes ?? []; this._render(); return this; }
  setOptions(opts) { Object.assign(this.opts, opts); this._render(); return this; }
  destroy() {
    this._ro.disconnect();
    this.el.removeEventListener?.('click', this._onClick);
    this.el.innerHTML = '';
  }

  _span() {
    if (this.opts.span) return { min: toMs(this.opts.span.min), max: toMs(this.opts.span.max) };
    let min = Infinity, max = -Infinity;
    for (const l of this.lanes) {
      for (const b of l.bars ?? []) {
        min = Math.min(min, toMs(b.start));
        max = Math.max(max, toMs(b.end));
      }
    }
    if (min === Infinity) return null;
    return max === min ? { min, max: max + 1 } : { min, max };
  }

  // kind -> {color, hatch}: configured first, then first-seen from the data
  _kinds() {
    const out = {};
    for (const [name, v] of Object.entries(this.opts.kinds ?? {})) {
      out[name] = typeof v === 'string' ? { color: v } : { color: v.color, hatch: v.hatch === true ? DIM : v.hatch };
    }
    let p = 0;
    for (const l of this.lanes) {
      for (const b of l.bars ?? []) {
        const k = b.kind ?? 'default';
        if (!out[k]) out[k] = { color: DEFAULT_PALETTE[p++ % DEFAULT_PALETTE.length] };
      }
    }
    return out;
  }

  _render() {
    const o = this.opts;
    const width = this.el.clientWidth;
    const span = this._span();
    if (!width || !span) { this.el.innerHTML = ''; return; }
    const barW = Math.max(width - o.labelWidth - o.labelGap, 1);
    const cols = Math.max(1, Math.floor(barW / o.cell));
    const bucketMs = (span.max - span.min) / cols;
    const W = span.max - span.min;
    const x = (ms) => ((Math.min(Math.max(ms, span.min), span.max) - span.min) / W) * barW;
    const kinds = this._kinds();
    const id = this._id;
    const fill = (k) => (kinds[k]?.hatch ? `url(#dl-hatch-${id}-${esc(k)})` : kinds[k]?.color ?? DIM);
    const tooltip = o.tooltip ?? ((b) => `${b.kind ?? 'default'} · ${fmtDur(b.end - b.start)}`);

    const axis = thinAxis(
      (o.autoAxis && o.autoAxis !== 'off'
        ? autoTicks(span.min, span.max, bucketMs, o.autoAxis, o.hour12)
        : (o.axis ?? [])
      ).map((a) => ({ ...a, x: x(toMs(a.t)), w: String(a.label).length * AXIS_PX })),
      barW, 6
    );

    const parts = [];
    // shared defs: the ruling and one hatch per hatched kind; every row's
    // SVG references them by id, which resolves document-wide
    parts.push(`<svg class="dl-lanes-defs" width="0" height="0" aria-hidden="true"><defs>` +
      `<pattern id="dl-rule-${id}" width="${o.cell}" height="${o.rowH}" patternUnits="userSpaceOnUse"><rect width="1" height="${o.rowH}" fill="${LINE}"/></pattern>` +
      Object.entries(kinds).filter(([, k]) => k.hatch).map(([name, k]) =>
        `<pattern id="dl-hatch-${id}-${esc(name)}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="${k.hatch}"/><rect width="2" height="4" fill="${k.color}"/></pattern>`
      ).join('') +
      `</defs></svg>`);

    if (axis.length) {
      parts.push(`<svg class="dl-lanes-axisrow" width="${barW}" height="14" style="margin-left:${o.labelWidth + o.labelGap}px" aria-hidden="true">` +
        axis.map((a) => `<text class="dl-lanes-axis" x="${a.tx}" y="9"${a.anchor !== 'middle' ? ` text-anchor="${a.anchor}"` : ''}>${esc(a.label)}</text>`).join('') +
        `</svg>`);
    }

    const hl = o.highlight ? { x1: x(toMs(o.highlight.from)), x2: x(toMs(o.highlight.to)) } : null;
    this.lanes.forEach((lane, i) => {
      const bars = laneBars(lane.bars, span.min, span.max).map((b) => {
        const bx = b.x0 * barW;
        const bw = Math.max(b.x1 * barW - bx, 1);
        const tip = b.title ?? tooltip(b, lane);
        return `<rect class="dl-bar" data-kind="${esc(b.kind ?? 'default')}" x="${bx}" y="0" width="${bw}" height="${o.rowH}" fill="${fill(b.kind ?? 'default')}"><title>${esc(tip)}</title></rect>`;
      }).join('');
      parts.push(`<div class="dl-lane" style="margin-top:${i ? o.gap : 0}px">` +
        `<button type="button" class="dl-lane-label" data-i="${i}" style="width:${o.labelWidth}px" title="${esc(lane.title ?? lane.label ?? '')}">${esc(lane.label ?? lane.id ?? '')}</button>` +
        `<svg width="${barW}" height="${o.rowH}" role="img" aria-label="${esc(o.label ?? lane.label ?? 'lane')}">` +
        `<rect class="dl-lane-rule" width="${barW}" height="${o.rowH}" fill="url(#dl-rule-${id})"/>` +
        (hl ? `<rect class="dl-highlight" x="${hl.x1}" y="0" width="${Math.max(hl.x2 - hl.x1, 2)}" height="${o.rowH}"/>` : '') +
        bars +
        `</svg></div>`);
    });

    this.el.innerHTML = parts.join('');
  }
}
