// Layout tests: pure functions, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketize, quantumFor, stack, rowsFor, stackLabels, autoTicks, thinAxis } from '../src/lattice.js';

test('bucketize: counts land in the right column; span edges are inclusive', () => {
  const evs = [
    { t: 0, group: 'a' }, { t: 0, group: 'b' },
    { t: 49, group: 'a' }, { t: 50, group: 'a' }, { t: 100, group: 'a' },
    { t: -1, group: 'a' }, { t: 101, group: 'a' },  // outside, ignored
  ];
  const b = bucketize(evs, 0, 100, 2);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0].sides, { up: 3 });
  assert.deepEqual(b[1].sides, { up: 2 });           // t=50 and the inclusive edge t=100
  assert.deepEqual(b[0].groups, { a: { up: 2 }, b: { up: 1 } });
  assert.equal(b[1].start, 50);
});

test('bucketize: missing group/side default; Date and string timestamps parse', () => {
  const b = bucketize([{ t: new Date(5) }, { t: '1970-01-01T00:00:00.020Z' }], 0, 100, 1);
  assert.deepEqual(b[0].groups, { default: { up: 2 } });
});

test('quantumFor: peak over maxRows, never below 1', () => {
  const b = [{ sides: { up: 25, down: 7 } }, { sides: { up: 3, down: 40 } }];
  assert.equal(quantumFor(b, 12), 4);                // ceil(40/12)
  assert.equal(quantumFor([], 12), 1);
  assert.equal(quantumFor([{ sides: { up: 5 } }], 12), 1);
});

test('stack: group order is baseline outward; rounding is cumulative', () => {
  // a=2, b=1 with quantum 2: side draws ceil(3/2)=2 dots, a first (closest
  // to baseline), then b
  const bucket = { groups: { a: { up: 2 }, b: { up: 1 } }, sides: { up: 3 } };
  assert.deepEqual(stack(bucket, 'up', 2, ['a', 'b']), [{ group: 'a' }, { group: 'b' }]);
  // a=4, b=1 with quantum 2: 3 dots, ceil rounding keeps the total honest
  const b2 = { groups: { a: { up: 4 }, b: { up: 1 } }, sides: { up: 5 } };
  assert.deepEqual(stack(b2, 'up', 2, ['a', 'b']), [{ group: 'a' }, { group: 'a' }, { group: 'b' }]);
  // unknown side or group contributes nothing
  assert.deepEqual(stack(b2, 'down', 2, ['a', 'b']), []);
  assert.deepEqual(stack({ groups: { z: { up: 3 } }, sides: { up: 3 } }, 'up', 1, ['a', 'b']), []);
});

test('rowsFor: max rows per side across buckets', () => {
  const buckets = [
    { groups: { a: { up: 3 } }, sides: { up: 3, down: 1 } },
    { groups: { a: { up: 1 }, b: { down: 5 } }, sides: { up: 1, down: 5 } },
  ];
  assert.deepEqual(rowsFor(buckets, 1, ['a', 'b']), { up: 3, down: 5 });
});

test('stackLabels: non-colliding share a row; collisions take the next row down', () => {
  const w = 200, gap = 10;
  const [a, b] = stackLabels([{ cx: 50, w: 20 }, { cx: 150, w: 20 }], w, gap);
  assert.equal(a.row, 0);
  assert.equal(b.row, 0);                            // far apart, same row
  const [c, d] = stackLabels([{ cx: 50, w: 20 }, { cx: 55, w: 20 }], w, gap);
  assert.equal(c.row, 0);
  assert.equal(d.row, 1);                            // touches c, drops a row
  assert.equal(d.anchor, 'middle');
});

test('stackLabels: edge labels clamp and re-anchor', () => {
  const [a] = stackLabels([{ cx: 2, w: 20 }], 200, 10);
  assert.equal(a.anchor, 'start');
  assert.equal(a.tx, 0);
  const [b] = stackLabels([{ cx: 198, w: 20 }], 200, 10);
  assert.equal(b.anchor, 'end');
  assert.equal(b.tx, 200);
});

// Renderer smoke test: a fake DOM is enough, the renderer only needs
// clientWidth, classList, innerHTML and a ResizeObserver stub.
test('autoTicks: unit choice, boundaries, and spacing', () => {
  // 7-day span starting 13:00 UTC, wide buckets -> day ticks at UTC midnights
  const d = 86400e3;
  const t0 = Date.UTC(2026, 8, 14, 13, 0);          // Sep 14 2026 13:00 UTC
  const days = autoTicks(t0, t0 + 7 * d, d, 'auto');
  assert.equal(days.length, 7);                     // Sep 15..21
  assert.equal(days[0].t, Date.UTC(2026, 8, 15));
  assert.ok(days.every((tk) => tk.t % d === 0));

  // zoomed to two hours, hour buckets -> hour ticks. t0 is itself an hour
  // boundary, so it is kept as the first tick
  const h = 3600e3;
  const hours = autoTicks(t0, t0 + 2 * h, h, 'auto');
  assert.equal(hours.length, 3);                    // 13:00, 14:00, 15:00
  assert.equal(hours[0].t, t0);
  assert.equal(hours[1].t, Date.UTC(2026, 8, 14, 14));
  assert.ok(hours.every((tk) => tk.t % h === 0));

  // explicit unit overrides the auto choice; a unit with no boundary
  // inside the span produces no ticks rather than noise
  const forced = autoTicks(t0, t0 + 3 * h, h, 'day');
  assert.deepEqual(forced, []);

  // week ticks land on Mondays
  const wk = autoTicks(Date.UTC(2026, 8, 16), Date.UTC(2026, 8, 30), d, 'week');
  assert.deepEqual(wk.map((x) => x.t), [Date.UTC(2026, 8, 21), Date.UTC(2026, 8, 28)]);

  // month ticks on the 1st
  const mo = autoTicks(Date.UTC(2026, 8, 15), Date.UTC(2026, 11, 15), 30 * d, 'month');
  assert.deepEqual(mo.map((x) => x.t), [Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1)]);

  // degenerate span
  assert.deepEqual(autoTicks(5, 5, 1, 'auto'), []);
});

test('thinAxis: dense labels are dropped, never overlapping; edges re-anchor', () => {
  // labels 20px wide at 0/10/20/... over 100px: every other one is dropped
  const items = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((x) => ({ x, w: 20, i: x }));
  const kept = thinAxis(items, 100, 6);
  // verify no two survivors overlap (6px gap honored)
  for (let i = 1; i < kept.length; i++) {
    assert.ok(kept[i].left >= kept[i - 1].left + kept[i - 1].w + 6,
      `overlap between ${kept[i - 1].x} and ${kept[i].x}`);
  }
  assert.ok(kept.length < items.length, 'dense axis was thinned');
  assert.equal(kept[0].x, 0);
  assert.equal(kept[0].anchor, 'start');            // clamped at the left edge
  assert.equal(kept[0].tx, 0);

  // a single label wider than the row is still kept (better one than none)
  const one = thinAxis([{ x: 50, w: 200 }], 100, 6);
  assert.equal(one.length, 1);

  // sparse labels all survive, middle-anchored
  const sparse = thinAxis([{ x: 20, w: 30 }, { x: 70, w: 30 }], 100, 6);
  assert.equal(sparse.length, 2);
  assert.ok(sparse.every((it) => it.anchor === 'middle'));
});

// Renderer smoke test: a fake DOM is enough, the renderer only needs
// clientWidth, classList, innerHTML and a ResizeObserver stub.
test('DotLattice: renders an SVG; shape/quantum/sides behave', async () => {
  globalThis.document = {
    createElement: () => ({ style: {}, set textContent(v) {}, remove() {} }),
    head: { appendChild() {} },
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const { DotLattice } = await import('../src/dotlattice.js');

  const el = { clientWidth: 400, classList: { add() {} }, innerHTML: '' };
  const evs = [];
  for (let i = 0; i < 30; i++) evs.push({ t: i, group: i < 10 ? 'a' : 'b', side: i % 2 ? 'up' : 'down' });
  const chart = new DotLattice(el, { cell: 8, maxRows: 12, dot: 2.5 });

  chart.setData(evs);
  assert.ok(el.innerHTML.startsWith('<svg'));
  assert.ok(el.innerHTML.includes('class="dl-base"'));
  // 400px / 8px cell = 50 columns; events span 0..29ms over 30 cols,
  // one event each: 30 dots total
  assert.equal((el.innerHTML.match(/<circle/g) || []).length, 30);

  // square shape swaps circles for rects
  chart.setOptions({ shape: 'square' });
  assert.equal((el.innerHTML.match(/<circle/g) || []).length, 0);
  assert.ok(el.innerHTML.includes('<rect x='));

  // tall columns force a quantum: 100 events in one column, maxRows 12
  const el2 = { clientWidth: 400, classList: { add() {} }, innerHTML: '' };
  const tall = Array.from({ length: 100 }, (_, i) => ({ t: 1, group: 'a' }));
  const c2 = new DotLattice(el2, { cell: 8, maxRows: 12 });
  c2.setData(tall);
  assert.equal(c2.quantum, 9);                       // ceil(100/12)
  assert.equal((el2.innerHTML.match(/<circle/g) || []).length, 12);

  // ticks + runs + highlight + axis all draw
  const el3 = { clientWidth: 400, classList: { add() {} }, innerHTML: '' };
  const c3 = new DotLattice(el3, {
    axis: [{ t: 0, label: 'MON' }],
    ticks: [{ t: 1, label: 'CONTRACT' }],
    runs: [{ start: 0, end: 1, title: 'blocked' }],
    highlight: { from: 0, to: 2 },
  });
  c3.setData([{ t: 1, group: 'a' }]);
  for (const frag of ['class="dl-axis"', 'class="dl-dash"', 'class="dl-run"', 'class="dl-highlight"', '<title>blocked</title>']) {
    assert.ok(el3.innerHTML.includes(frag), frag);
  }

  chart.destroy();
  c2.destroy();
  c3.destroy();
});

test('DotLattice: setView zooms, regenerates ticks/axis, fires onSelect; brush drag selects', async () => {
  const { DotLattice } = await import('../src/dotlattice.js');
  const listeners = {};
  const el = {
    clientWidth: 400, classList: { add() {} }, innerHTML: '', style: {},
    appendChild() {},
    addEventListener(ev, fn) { listeners[ev] = fn; },
    removeEventListener() {},
  };
  const d = 86400e3;
  const evs = Array.from({ length: 200 }, (_, i) => ({ t: i * d / 4 }));
  const views = [];
  const c = new DotLattice(el, {
    brush: true,
    autoAxis: 'auto',
    onSelect: (v) => views.push(v),
  });
  c.setData(evs);

  // full span: day-ticks drawn, 50 columns of dots
  const full = el.innerHTML;
  assert.ok(full.includes('class="dl-axis"'));
  assert.ok(!full.includes('dl-zoom'));
  const fullDots = (full.match(/<circle/g) || []).length;
  assert.ok(fullDots > 150, 'most events visible at full span');

  // programmatic zoom into a 2-day window
  c.setView(0, 2 * d);
  assert.deepEqual(views.at(-1), { from: 0, to: 2 * d });
  assert.ok(el.innerHTML.includes('dl-zoom'));
  assert.ok(el.innerHTML.includes('class="dl-axis"'));        // axis regenerated for the view
  // 2-day window over 400px = 50 cols of 57.6min buckets: hour ticks
  // generated, then thinned so labels (~48px) never overlap; the right
  // ~200px is reserved for the range readout
  const axisCount = (el.innerHTML.match(/class="dl-axis dl-zoom"/g) || []).length;
  const hourTicks = (el.innerHTML.match(/class="dl-axis"(?! dl-zoom)/g) || []).length;
  assert.equal(axisCount, 1);                      // the readout
  assert.ok(hourTicks >= 2 && hourTicks <= 6, 'thinned hour ticks for the 2-day view, got ' + hourTicks);

  // brush drag: pointerdown at x=100, move to x=200, up -> selects the
  // second quarter of the 2-day view (0.5d..1d)
  c.el.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 100 });
  const winListeners = {};
  globalThis.window = { addEventListener: (e, fn) => (winListeners[e] = fn), removeEventListener: () => {} };
  c._unbindBrush(); c._bindBrush();                 // rebind against the window stub
  listeners.pointerdown({ clientX: 100, clientY: 10 });
  winListeners.pointermove({ clientX: 200, clientY: 10 });
  winListeners.pointerup({});
  const sel = views.at(-1);
  assert.ok(sel && sel.from === d / 2 && sel.to === d,
    'drag selected a half-day window: ' + JSON.stringify(sel));

  // reset via setView(null,null) reports null
  c.setView(null, null);
  assert.equal(views.at(-1), null);

  c.destroy();
});
