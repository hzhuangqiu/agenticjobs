/**
 * Watches: what one is called, and which searches can be one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWatchable, labelFor, watchMessage, watchPath, watchQuery } from '../src/core/watches.ts';
import { pathForQuery } from '../src/core/landing.ts';
import { EMPTY_QUERY } from '../src/schema/query.ts';
import { normaliseSkills } from '../src/core/agents.ts';

test('a watch is named the way a person would say it', () => {
  assert.equal(
    labelFor({ ...EMPTY_QUERY, tags: ['rust'], workplace: 'remote' }),
    'remote rust jobs',
  );
  assert.equal(
    labelFor({
      ...EMPTY_QUERY,
      q: 'compiler',
      seniority: 'senior',
      agentPolicy: 'welcome',
      salaryMin: 150_000,
    }),
    'senior "compiler" jobs, agents welcome, 150,000+',
  );
  assert.equal(labelFor(EMPTY_QUERY), 'all jobs');
});

test('a watch on everything is refused; anything narrower is allowed', () => {
  assert.equal(isWatchable(EMPTY_QUERY), false);
  assert.equal(
    isWatchable({ ...EMPTY_QUERY, limit: 5, offset: 50, sort: 'salary' }),
    false,
    'paging is not a filter',
  );
  assert.equal(isWatchable({ ...EMPTY_QUERY, workplace: 'remote' }), true);
  assert.equal(isWatchable({ ...EMPTY_QUERY, q: 'rust' }), true);
});

test('a watch drops the screenful and keeps the search', () => {
  const stored = watchQuery({ ...EMPTY_QUERY, tags: ['go'], limit: 3, offset: 30, sort: 'salary' });
  assert.equal(stored.limit, 25);
  assert.equal(stored.offset, 0);
  assert.equal(stored.sort, 'recent');
  assert.deepEqual(stored.tags, ['go']);
});

test('a watch lives at its landing page when it has one, else at the querystring', () => {
  assert.equal(
    watchPath({ ...EMPTY_QUERY, tags: ['rust'], workplace: 'remote' }, pathForQuery),
    '/rust/remote',
  );
  assert.equal(watchPath({ ...EMPTY_QUERY, q: 'rust' }, pathForQuery), '/?q=rust');
});

test('the email names the listing and links to it and to the watch, and nothing else', () => {
  const message = watchMessage({
    to: 'a@example.test',
    boardName: 'Agentic Jobs',
    label: 'remote rust jobs',
    job: {
      title: 'Rust engineer',
      slug: 'rust-engineer',
      org: { name: 'Acme' },
      pay: { lines: [], method: null, equity: null, unpaid: false },
      salary: {
        min: 120000,
        max: 150000,
        currency: 'USD',
        period: 'year',
        equity: null,
        unpaid: false,
      },
    } as never,
    url: 'https://board.test/jobs/rust-engineer',
    watchUrl: 'https://board.test/rust/remote',
  });
  assert.equal(message.to, 'a@example.test');
  assert.match(message.subject, /Rust engineer at Acme/);
  assert.match(message.text, /remote rust jobs/);
  assert.match(message.text, /https:\/\/board\.test\/jobs\/rust-engineer/);
  assert.match(message.html, /href="https:\/\/board\.test\/rust\/remote"/);
  assert.doesNotMatch(message.html, /<script/);
});

test('skills arrive as an array, a comma list or lines, and come out lowercased and unique', () => {
  assert.deepEqual(normaliseSkills(['Rust', 'rust ', 'Code Review']), ['rust', 'code review']);
  assert.deepEqual(normaliseSkills('rust, go,, Go\npython'), ['rust', 'go', 'python']);
  assert.deepEqual(normaliseSkills(''), []);
  assert.deepEqual(normaliseSkills(42), []);
});
