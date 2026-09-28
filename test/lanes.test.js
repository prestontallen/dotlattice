// Lanes: the pure clipping and the HTML/SVG rows, rendered into a fake
// element like the DotLattice tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { laneBars, thinAxis } from '../src/lattice.js';

const H = 3600e3;
function fakeDom() {
  globalThis.document = {
    createElement: () => ({ style: {}, set textContent(v) {}, remove() {} }),
    head: { appendChild() {} },
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const listeners = {};
  return {
    clientWidth: 400, classList: { add() {} }, innerHTML: '', listeners,
    addEventListener(ev, fn) { listeners[ev] = fn; },
    removeEventListener(ev) { delete listeners[ev]; },
  };
}
const count = (html, re) => (html.match(re) || []).length;

test('laneBars: clips to the span, drops outside and empty bars', () => {
  const bars = [
    { start: -50, end: 20, kind: 'building' },
    { start: 20, end: 150, kind: 'checking' },
    { start: 200, end: 300, kind: 'shipping' },   // after the span
    { start: -20, end: -10, kind: 'queued' },     // before the span
    { start: 30, end: 30, kind: 'queued' },       // empty
  ];
  const out = laneBars(bars, 0, 100);
  assert.deepEqual(out.map((b) => [b.kind, b.start, b.end, b.x0, b.x1]),
    [['building', 0, 20, 0, 0.2], ['checking', 20, 100, 0.2, 1]]);
  assert.deepEqual(laneBars(bars, 100, 100), []);
  assert.deepEqual(laneBars(undefined, 0, 1), []);
  // Date and string timestamps parse like the lattice's
  assert.equal(laneBars([{ start: new Date(10), end: '1970-01-01T00:00:00.050Z' }], 0, 100)[0].x1, 0.5);
});

test('Lanes: one row per lane, bars clipped, empty lanes keep their row, no lanes draws only defs', async () => {
  const { Lanes } = await import('../src/lanes.js');
  const el = fakeDom();
  const c = new Lanes(el, { span: { min: 0, max: 10 * H }, labelWidth: 100, labelGap: 10, cell: 8, rowH: 9 });
  c.setData([
    { id: 'a', label: 'alpha', title: 'Alpha, the first', bars: [{ start: -H, end: 2 * H, kind: 'building' }, { start: 2 * H, end: 20 * H, kind: 'checking' }] },
    { id: 'b', label: 'beta', bars: [] },
  ]);
  const html = el.innerHTML;
  assert.equal(count(html, /class="dl-lane"/g), 2);
  assert.equal(count(html, /class="dl-bar"/g), 2);
  // bar area is 400 - 100 - 10 = 290px wide: the first bar spans 0..20%
  const bars = [...html.matchAll(/<rect class="dl-bar" data-kind="(\w+)" x="([\d.]+)" y="0" width="([\d.]+)"/g)].map((m) => [m[1], +m[2], +m[3]]);
  assert.deepEqual(bars[0], ['building', 0, 58]);
  assert.equal(bars[1][0], 'checking');
  assert.equal(bars[1][1], 58);
  assert.equal(bars[1][1] + bars[1][2], 290);
  assert.ok(html.includes('title="Alpha, the first">alpha</button>'));
  assert.ok(html.includes('data-i="1" style="width:100px" title="beta">beta</button>'));
  assert.ok(!html.includes('dl-lanes-axisrow'), 'no axis given, no axis strip');

  c.setData([]);
  assert.ok(el.innerHTML.startsWith('<svg class="dl-lanes-defs"'));
  assert.equal(count(el.innerHTML, /class="dl-lane"/g), 0);
  c.destroy();
  assert.equal(el.innerHTML, '');
  assert.equal(el.listeners.click, undefined);
});

test('Lanes: a hatched kind fills from a pattern of its two colours, others solid; unknown kinds take the palette', async () => {
  const { Lanes } = await import('../src/lanes.js');
  const el = fakeDom();
  const c = new Lanes(el, {
    span: { min: 0, max: 10 * H },
    kinds: { building: '#0f0', blocked: { color: '#f00', hatch: '#500' }, dim: { color: '#00f', hatch: true } },
  });
  c.setData([{ label: 'a', bars: [
    { start: 0, end: H, kind: 'building' }, { start: H, end: 2 * H, kind: 'blocked' },
    { start: 2 * H, end: 3 * H, kind: 'dim' }, { start: 3 * H, end: 4 * H, kind: 'other' },
  ] }]);
  const html = el.innerHTML;
  const id = html.match(/id="dl-rule-(\d+)"/)[1];
  assert.ok(html.includes(`<pattern id="dl-hatch-${id}-blocked" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#500"/><rect width="2" height="4" fill="#f00"/></pattern>`));
  assert.ok(html.includes(`<pattern id="dl-hatch-${id}-dim"`) && html.includes('fill="var(--dl-dim, #5c6370)"/><rect width="2" height="4" fill="#00f"/>'));
  assert.ok(!html.includes(`dl-hatch-${id}-building`));
  const fills = [...html.matchAll(/data-kind="(\w+)"[^>]*fill="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(fills, [
    ['building', '#0f0'], ['blocked', `url(#dl-hatch-${id}-blocked)`], ['dim', `url(#dl-hatch-${id}-dim)`], ['other', '#7aa2f7'],
  ]);
  assert.ok(html.includes(`fill="url(#dl-rule-${id})"`), 'the ruling is a pattern too');
});

test('Lanes: label click reaches onLabel with the lane; bar titles are tooltip, then bar.title, then kind and duration', async () => {
  const { Lanes } = await import('../src/lanes.js');
  const el = fakeDom();
  const clicked = [];
  const lanes = [
    { id: 'a', label: 'a', bars: [{ start: 0, end: 90 * 60e3, kind: 'building' }, { start: H, end: 2 * H, kind: 'checking', title: 'own title' }] },
    { id: 'b', label: 'b', bars: [] },
  ];
  const c = new Lanes(el, { span: { min: 0, max: 3 * H }, onLabel: (lane) => clicked.push(lane.id) });
  c.setData(lanes);
  el.listeners.click({ target: { closest: () => ({ dataset: { i: '1' } }) } });
  el.listeners.click({ target: { closest: () => null } });
  assert.deepEqual(clicked, ['b']);
  assert.ok(el.innerHTML.includes('<title>building · 1h 30m</title>'));
  assert.ok(el.innerHTML.includes('<title>own title</title>'));

  c.setOptions({ tooltip: (b, lane) => `${lane.id}/${b.kind}` });
  assert.ok(el.innerHTML.includes('<title>a/building</title>'));
  assert.ok(el.innerHTML.includes('<title>own title</title>'), 'a bar title still wins');
});

test('Lanes: the axis strip carries the same thinned labels a lattice would for the bar width', async () => {
  const { Lanes } = await import('../src/lanes.js');
  const el = fakeDom();
  const axis = [];
  for (let i = 0; i <= 24; i++) axis.push({ t: i * H, label: `${String(i).padStart(2, '0')}:00` });
  const c = new Lanes(el, { span: { min: 0, max: 24 * H }, axis, labelWidth: 100, labelGap: 10, highlight: { from: 2 * H, to: 4 * H } });
  c.setData([{ label: 'a', bars: [{ start: 0, end: H, kind: 'k' }] }]);
  const html = el.innerHTML;
  const barW = 290;
  const want = thinAxis(axis.map((a) => ({ ...a, x: (a.t / (24 * H)) * barW, w: 5 * 6 })), barW, 6);
  const got = [...html.matchAll(/<text class="dl-lanes-axis" x="([\d.]+)" y="9"[^>]*>([^<]+)<\/text>/g)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(got, want.map((a) => [a.tx, a.label]));
  assert.ok(got.length >= 3 && got.length < axis.length, 'dense labels thinned');
  assert.ok(html.includes('style="margin-left:110px"'), 'axis strip sits over the bars');
  assert.ok(html.includes('class="dl-highlight"'));
});
