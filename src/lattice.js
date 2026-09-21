// dotlattice — pure layout functions for the dot-lattice time series.
// Testable without a DOM: the renderer (dotlattice.js) owns pixels and
// the DOM; this file owns the counting and the geometry-free layout.
//
// Data model: an event is {t, group, side}.
//   t     — timestamp (ms number, Date, or parseable string)
//   group — categorical series (drives color + stacking order), default 'default'
//   side  — which side of the baseline the event stacks on, default 'up'

export function toMs(t) {
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  return Date.parse(t);
}

// Bucket events into `cols` equal time slots over [min, max]. Each bucket
// carries per-group per-side counts plus side totals. Events outside the
// span are ignored; the last edge is inclusive so the newest event lands.
export function bucketize(events, min, max, cols) {
  const out = Array.from({ length: cols }, (_, i) => ({
    i, start: min + ((max - min) * i) / cols, groups: {}, sides: {}
  }));
  if (cols <= 0 || max <= min) return out;
  for (const e of events) {
    const t = toMs(e.t);
    if (t < min || t > max) continue;
    const i = Math.min(cols - 1, Math.floor(((t - min) / (max - min)) * cols));
    const b = out[i];
    const g = e.group ?? 'default';
    const s = e.side ?? 'up';
    (b.groups[g] ??= {})[s] = (b.groups[g][s] ?? 0) + 1;
    b.sides[s] = (b.sides[s] ?? 0) + 1;
  }
  return out;
}

// How many events one dot stands for, so the tallest side fits maxRows.
export function quantumFor(buckets, maxRows) {
  let peak = 0;
  for (const b of buckets) {
    for (const n of Object.values(b.sides)) peak = Math.max(peak, n);
  }
  return Math.max(1, Math.ceil(peak / maxRows));
}

// The dots for one side of one bucket, baseline outward: [{group}].
// groupOrder fixes the stacking order. Rounding runs over the side's
// cumulative count, not per group, so the side always draws exactly
// ceil(total / quantum) dots and the counts stay honest.
export function stack(bucket, side, quantum, groupOrder) {
  const dots = [];
  let cum = 0;
  for (const g of groupOrder) {
    const c = bucket.groups[g]?.[side];
    if (!c) continue;
    const before = Math.ceil(cum / quantum);
    cum += c;
    for (let n = Math.ceil(cum / quantum) - before; n > 0; n--) dots.push({ group: g });
  }
  return dots;
}

// Rows needed on each side, given the quantum.
export function rowsFor(buckets, quantum, groupOrder) {
  const rows = {};
  for (const b of buckets) {
    for (const s of Object.keys(b.sides)) {
      rows[s] = Math.max(rows[s] ?? 0, stack(b, s, quantum, groupOrder).length);
    }
  }
  return rows;
}

// Time-axis ticks for a span. unit is one of 'auto' | 'millisecond' |
// 'minute' | 'hour' | 'day' | 'week' | 'month'; 'auto' picks a unit from
// the span length and bucket width so labels stay legible, and spaces
// ticks on that unit's natural UTC boundaries (a day tick lands at UTC
// midnight, a month tick on the 1st). Returns [{t, label}].
const UNITS = [
  { name: 'millisecond', ms: 1, fmt: (d, h12) => d.toLocaleTimeString([], { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: h12 }) },
  { name: 'minute',     ms: 60e3, fmt: (d, h12) => d.toLocaleTimeString([], { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: h12 }) },
  { name: 'hour',       ms: 3600e3, fmt: (d, h12) => d.toLocaleTimeString([], { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: h12 }) },
  { name: 'day',        ms: 86400e3, fmt: (d) => d.toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric' }) },
  { name: 'week',       ms: 7 * 86400e3, fmt: (d) => d.toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric' }) },
  { name: 'month',      ms: 30 * 86400e3, fmt: (d) => d.toLocaleDateString([], { timeZone: 'UTC', month: 'short', year: '2-digit' }) },
];

function firstBoundary(unit, t) {
  const d = new Date(t);
  switch (unit) {
    case 'millisecond': return t;
    case 'minute': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
    case 'hour': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
    case 'day': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    case 'week': {
      const dow = d.getUTCDay();                    // 0 Sun..6 Sat; weeks from Monday
      const back = (dow + 6) % 7;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
    }
    case 'month': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
}
function nextBoundary(unit, t) {
  const d = new Date(t);
  switch (unit) {
    case 'millisecond': return t + 1;
    case 'minute': return t + 60e3;
    case 'hour': return t + 3600e3;
    case 'day': return t + 86400e3;
    case 'week': return t + 7 * 86400e3;
    case 'month': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
}

export function autoTicks(min, max, bucketMs, unit = 'auto', hour12 = false) {
  if (!(max > min)) return [];
  const u = UNITS.find((x) => x.name === unit);
  let def = u;
  if (!def) {
    // auto: the largest unit whose label fits at ~2 buckets' width, so
    // adjacent labels never collide on the axis row
    def = [...UNITS].reverse().find((x) => x.ms <= Math.max(bucketMs * 2, 1)) ?? UNITS[0];
    // but also require the span to show at least 2 of them, else drop a level
    while (def !== UNITS[0] && (max - min) < def.ms * 2) def = UNITS[UNITS.indexOf(def) - 1];
  }
  const out = [];
  let t = firstBoundary(def.name, min);
  if (t < min) t = nextBoundary(def.name, t);
  // never more than one tick per column
  for (let i = 0; t <= max && i < 1e4; i++) {
    out.push({ t, label: def.fmt(new Date(t), hour12) });
    t = nextBoundary(def.name, t);
  }
  return out;
}

// Axis labels on a single row: like stackLabels, but a label that would
// touch the last kept one is dropped instead of re-rowed — an axis never
// stacks. Each survivor is centred on its x, clamped and re-anchored at
// the edges. Items are {x, w} in x order; the result adds anchor and tx.
// The caller can pass a narrowed `width` to reserve the right edge (e.g.
// for a zoom readout drawn there).
export function thinAxis(items, width, gap = 6) {
  const out = [];
  let right = -Infinity;
  for (const it of items) {
    let left = it.x - it.w / 2, anchor = 'middle';
    if (left < 0) { left = 0; anchor = 'start'; }
    else if (left + it.w > width) { left = width - it.w; anchor = 'end'; }
    if (left < right + gap) continue;
    right = left + it.w;
    out.push({ ...it, left, anchor, tx: anchor === 'middle' ? it.x : anchor === 'start' ? 0 : width });
  }
  return out;
}

// Milestone labels along a width: each stays centred on its own line
// (clamped inside the edges); one that would touch an earlier label takes
// the lowest free row, so coincident labels pile straight down. Items are
// {cx, w} and must arrive in nondecreasing cx order (time order), since
// each row only remembers its right edge; the result adds row, tx, anchor.
export function stackLabels(items, width, gap = 10) {
  const rowsRight = [];
  return items.map((it) => {
    let left = it.cx - it.w / 2, anchor = 'middle';
    if (left < 0) { left = 0; anchor = 'start'; }
    else if (left + it.w > width) { left = width - it.w; anchor = 'end'; }
    let row = 0;
    while (row < rowsRight.length && left < rowsRight[row] + gap) row++;
    rowsRight[row] = left + it.w;
    return { ...it, row, anchor, tx: anchor === 'middle' ? it.cx : anchor === 'start' ? 0 : width };
  });
}
