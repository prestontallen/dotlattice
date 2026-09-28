// 0.2.0: tick labels on hover, and the always-mode snapshot against 0.1.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureInput } from './fixture.js';

function fakeDom() {
  globalThis.document = {
    createElement: () => ({ style: {}, set textContent(v) {}, remove() {} }),
    head: { appendChild() {} },
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  return { clientWidth: 400, classList: { add() {} }, innerHTML: '' };
}
const count = (html, re) => (html.match(re) || []).length;
const height = (s) => Number(s.match(/<svg width="400" height="([\d.]+)"/)[1]);

test('DotLattice: always mode renders exactly as 0.1.0 apart from data-index', async () => {
  const { DotLattice } = await import('../src/dotlattice.js');
  const el = fakeDom();
  const { opts, events } = fixtureInput();
  new DotLattice(el, opts).setData(events);
  const want = readFileSync(new URL('./fixtures/ticks-always-0.1.0.svg', import.meta.url), 'utf8');
  assert.equal(el.innerHTML.replace(/ data-index="\d+"/g, ''), want);
  // every label carries its time-order index
  assert.deepEqual([...el.innerHTML.matchAll(/data-index="(\d+)"/g)].map((m) => m[1]), ['0', '1', '2', '3']);
  assert.ok(!el.innerHTML.includes('dl-tickmark'));
});

test('DotLattice: hover mode collapses a column to one marker, hides labels, reserves capped rows', async () => {
  const { DotLattice } = await import('../src/dotlattice.js');
  const { opts, events } = fixtureInput();

  const always = fakeDom();
  new DotLattice(always, opts).setData(events);
  const el = fakeDom();
  new DotLattice(el, { ...opts, tickLabels: 'hover' }).setData(events);
  const html = el.innerHTML;

  // four ticks in three columns: alpha and beta share the 10h column
  assert.equal(count(html, /class="dl-tickcol"/g), 3);
  assert.equal(count(html, /class="dl-tickmark"/g), 3);
  assert.equal(count(html, /class="dl-tick"/g), 4);
  assert.deepEqual([...html.matchAll(/data-index="(\d+)"/g)].map((m) => m[1]), ['0', '1', '2', '3']);
  // the shared column's marker names both ticks: title, or label when none
  assert.ok(html.includes('<title>contract alpha\nCONTRACT</title>'), 'marker title lists the column');
  // the labels of one column pile straight down: same x, rows 0 and 1
  const col = html.match(/<g class="dl-tickcol"[^]*?<\/g><\/g>/)[0];
  const ys = [...col.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [m[1], m[2]]);
  assert.equal(ys.length, 2);
  assert.equal(ys[0][0], ys[1][0]);
  assert.equal(Number(ys[1][1]) - Number(ys[0][1]), 11);
  // every column group holds its dash, its hit corridor and its marker
  assert.equal(count(html, /class="dl-dash"/g), 3);
  assert.equal(count(html, /class="dl-tickhit"/g), 3);

  // height: always mode stacks three rows (alpha, beta, then PRESENTED
  // colliding with both); hover reserves the tallest column, two rows,
  // and maxLabelRows caps that at one
  assert.ok(height(html) < height(always.innerHTML), `hover ${height(html)} < always ${height(always.innerHTML)}`);
  const capped = fakeDom();
  new DotLattice(capped, { ...opts, tickLabels: 'hover', maxLabelRows: 1 }).setData(events);
  assert.equal(height(html) - height(capped.innerHTML), 11);

  // no ticks: no marker strip, same height as always mode
  const none = fakeDom(), noneA = fakeDom();
  new DotLattice(none, { ...opts, ticks: [], tickLabels: 'hover' }).setData(events);
  new DotLattice(noneA, { ...opts, ticks: [] }).setData(events);
  assert.equal(height(none.innerHTML), height(noneA.innerHTML));
  assert.ok(!none.innerHTML.includes('dl-tickcol'));
});
