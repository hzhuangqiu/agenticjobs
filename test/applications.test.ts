import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateApplication, submitApplication } from '../dist/core/applications.js';

const schema = {
  fields: [
    { name: 'name', label: 'Name', type: 'text' as const, required: true, maxLength: 120 },
  ],
};

test('a disclose policy requires the agent field instead of accepting omission', () => {
  const missing = validateApplication(schema, { name: 'Ada' }, 'disclose');
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.deepEqual(missing.problems, [
    {
      field: 'agent',
      message: 'This employer asks applications written with an agent to say so.',
    },
  ]);

  const valid = validateApplication(
    schema,
    { name: 'Ada', agent: { name: 'test-agent', supervised: true } },
    'disclose',
  );
  assert.equal(valid.ok, true);
});

test('submitting a draft with a malformed id is a miss, not a database error', async () => {
  // POST /api/v1/applications/:id/submit hands the path segment to the query.
  // A string that is not a uuid makes Postgres raise `invalid input syntax
  // for type uuid` - a 500 for what is really "no such draft", which is why
  // decideApplication checks the shape first.
  let reached = false;
  const pool = {
    query: async () => {
      reached = true;
      return { rows: [], rowCount: 0 };
    },
  };
  const sent = await submitApplication(
    pool as never,
    'not-a-uuid',
    '00000000-0000-4000-8000-000000000000',
  );
  assert.equal(sent, 'not_found');
  assert.equal(reached, false, 'a malformed id never reaches the database');
});

test('submitting a draft reports when its job has stopped accepting applications', async () => {
  let sql = '';
  const pool = {
    query: async (statement: string) => {
      sql = statement;
      return { rows: [{ outcome: 'job_not_open' }], rowCount: 0 };
    },
  };
  const sent = await submitApplication(
    pool as never,
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  );
  assert.equal(sent, 'job_not_open');
  assert.match(sql, /j\.status = 'published'/);
  assert.match(sql, /j\.expires_at is null or j\.expires_at > now\(\)/);
});

test('an application field named __proto__ keeps its submitted answer', () => {
  const result = validateApplication(
    {
      fields: [
        { name: '__proto__', label: 'Portfolio', type: 'text', required: true, maxLength: 120 },
      ],
    },
    JSON.parse('{"__proto__":"https://example.com/work"}') as Record<string, unknown>,
    'welcome',
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.hasOwn(result.value.answers, '__proto__'), true);
  assert.equal(result.value.answers['__proto__'], 'https://example.com/work');
  assert.equal(
    JSON.stringify(result.value.answers),
    '{"__proto__":"https://example.com/work"}',
  );
});
