import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPay, normalisePay } from '../dist/schema/pay.js';

function pay(input: Record<string, unknown>) {
  const parsed = normalisePay(input);
  assert.notEqual(typeof parsed, 'string', String(parsed));
  return parsed as Exclude<typeof parsed, string>;
}

test('a settlement clause on its own line names the method, not a line', () => {
  const split = pay({ pay: '$0.25 per task; settled in SOL' });
  assert.equal(split.lines.length, 1);
  assert.equal(split.method, 'SOL');
  assert.equal(formatPay(split), '$0.25 per task');

  const ownLine = pay({ pay: '$0.25 per task\nsettled in SOL' });
  assert.equal(ownLine.lines.length, 1);
  assert.equal(ownLine.method, 'SOL');

  const ownEntry = pay({ pay: ['$100 an hour', 'via bank transfer'] });
  assert.equal(ownEntry.lines.length, 1);
  assert.equal(ownEntry.method, 'bank transfer');
  assert.equal(formatPay(ownEntry), '$100 an hour');

  const wrapped = pay({ pay: [{ text: 'paid in USDC' }, { text: '$5k fixed' }] });
  assert.equal(wrapped.lines.length, 1);
  assert.equal(wrapped.method, 'USDC');
});

test('a clause before the lines, a rail word and an unknown place', () => {
  const first = pay({ pay: ['via bank transfer', '$100 an hour'] });
  assert.equal(first.method, 'bank transfer');
  assert.equal(first.lines.length, 1);

  const rail = pay({ pay: ['$100 an hour', 'by card'] });
  assert.equal(rail.method, 'card');

  // A word the file does not know is not a rail, and still refuses the lot.
  assert.equal(typeof normalisePay({ pay: ['$100 an hour', 'in London'] }), 'string');
  assert.equal(typeof normalisePay({ pay: ['$100 an hour', 'paid in magic beans'] }), 'string');
});

test('an explicit payMethod still wins over a clause, and unpaid still wins over all', () => {
  const explicit = pay({ pay: ['$100 an hour', 'settled in SOL'], payMethod: 'usdc' });
  assert.equal(explicit.method, 'USDC');

  const clause = pay({ pay: ['$100 an hour paid in ETH', 'settled in SOL'] });
  assert.equal(clause.method, 'ETH', 'the first named rail wins, in line order');

  const unpaid = pay({ pay: 'unpaid\nsettled in SOL' });
  assert.equal(unpaid.unpaid, true);
  assert.deepEqual(unpaid.lines, []);
  assert.equal(unpaid.method, 'SOL');
});
