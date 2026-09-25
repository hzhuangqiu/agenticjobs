import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEvents, summarize } from '../dist/core/tracker.js';
import { hoursGap, improvements, ledgerGaps, TrackerPage } from '../dist/views/tracker.js';

const fleet = {
  id: 'f1',
  slug: 'demo',
  ownerId: 'u1',
  operatorSlug: 'op',
  agents: 10,
  currency: 'USD',
  rate: 100,
  retainedTarget: 50,
  assumedDirectCost: 100,
  publicListing: false,
  updatedAt: '2026-09-25T00:00:00Z',
};
const report = (events: unknown[]) => {
  const parsed = parseEvents(events, 'USD');
  return { fleet, summary: summarize(fleet, parsed), sources: ['s'], eventCount: parsed.length };
};
const render = (r: ReturnType<typeof report>) =>
  String(TrackerPage({ fleets: [fleet], report: r, profiles: [] }));

test('a fleet with only costs shows zeros and names every missing feed', () => {
  const r = report([
    { id: 'c1', kind: 'cost', currency: 'USD', amount: 12, provenance: 'estimated' },
    {
      id: 'c2',
      kind: 'cost',
      currency: 'USD',
      amount: null,
      provenance: 'reported',
      partial: true,
    },
  ]);
  assert.equal(hoursGap(r.summary), 'No work imported yet.');
  assert.deepEqual(ledgerGaps(r.summary), [
    'No receipts, commissions, fees or affiliate payouts imported yet.',
    'Cost entries with no amount: 1.',
  ]);
  const html = render(r);
  assert.doesNotMatch(html, /Unknown/);
  assert.match(html, /<h2>0\.00<\/h2>/);
  assert.match(html, /<h2>USD 0<\/h2>/);
  assert.doesNotMatch(html, /<h2>USD -/, 'incomplete profit is shown as zero, not as costs alone');
  assert.match(html, /Costs imported so far: USD 12\./);
  assert.match(html, /No work imported yet\./);
});

test('improvement tips always point at applying to and posting jobs', () => {
  const tips = improvements(report([]));
  assert.deepEqual(
    tips.slice(0, 2).map((t) => t.href),
    ['/', '/post-a-job'],
  );
  assert.ok(
    tips.some((t) => /leaderboard/.test(t.text)),
    'private fleets are told to list',
  );
  assert.ok(
    tips.some((t) => /at least USD 150\/agent-hour/.test(t.text)),
    'a rate below cost plus target is called out',
  );
  const html = render(report([]));
  assert.match(html, /How to improve/);
  assert.match(html, /href="\/post-a-job"/);
});

test('costs without billable hours get a billing tip, and billable work without time is named', () => {
  const tips = improvements(
    report([{ id: 'c1', kind: 'cost', currency: 'USD', amount: 30, provenance: 'engine' }]),
  );
  assert.ok(tips.some((t) => /USD 30 of costs and no billable hours/.test(t.text)));
  const r = report([{ id: 'w1', kind: 'work', currency: 'USD', billable: true }]);
  assert.equal(hoursGap(r.summary), 'Billable work entries missing time or agent counts: 1.');
});

test('a complete, on-target fleet shows no missing notes', () => {
  const r = report([
    { id: 'w1', kind: 'work', currency: 'USD', billable: true, seconds: 3600, agents: 1 },
    { id: 'c', kind: 'cost', currency: 'USD', amount: 10, provenance: 'engine' },
    { id: 'r', kind: 'receipt', currency: 'USD', amount: 100, provenance: 'reported' },
    { id: 'm', kind: 'commission', currency: 'USD', amount: 0, provenance: 'reported' },
    { id: 'f', kind: 'fee', currency: 'USD', amount: 0, provenance: 'reported' },
    { id: 'a', kind: 'affiliate', currency: 'USD', amount: 0, provenance: 'reported' },
  ]);
  assert.equal(hoursGap(r.summary), null);
  assert.deepEqual(ledgerGaps(r.summary), []);
  assert.doesNotMatch(render(r), /tracker-missing/);
});
