// One fixed input for the always-mode snapshot: explicit axis labels (no
// locale), ticks that share columns and ticks that collide, a run and a
// highlight. Rendered by 0.1.0 into fixtures/ticks-always-0.1.0.svg; the
// current renderer must match it apart from data-index.
export function fixtureInput() {
  const H = 3600e3;
  const events = [];
  for (let i = 0; i < 48; i++) events.push({ t: i * H, group: i % 3 ? 'a' : 'b', side: i % 2 ? 'human' : 'agent' });
  for (let i = 0; i < 20; i++) events.push({ t: 10 * H, group: 'a', side: 'human' });
  const opts = {
    cell: 8, maxRows: 12, dot: 2.5, gap: 10,
    span: { min: 0, max: 48 * H },
    groups: [{ name: 'a', color: '#7aa2f7' }, { name: 'b', color: '#e0af68' }],
    sides: { human: 'up', agent: 'down' },
    axis: [{ t: 0, label: 'DAY 1' }, { t: 24 * H, label: 'DAY 2' }],
    ticks: [
      { t: 10 * H, label: 'CONTRACT', sig: 'alpha', title: 'contract alpha' },
      { t: 10 * H + 1e5, label: 'CONTRACT', sig: 'beta', color: '#9ece6a' },      // same column as alpha
      { t: 11 * H, label: 'PRESENTED', sig: 'alpha' },                              // collides with the column above
      { t: 40 * H, label: 'SHIPPED', sig: 'gamma', color: '#f7768e', title: 'shipped gamma' },
    ],
    runs: [{ start: 20 * H, end: 25 * H, title: 'blocked' }],
    highlight: { from: 5 * H, to: 15 * H },
    label: 'fixture',
  };
  return { opts, events };
}
