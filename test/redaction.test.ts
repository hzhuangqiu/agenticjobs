/**
 * Withholding contact channels from signed-out readers.
 *
 * Both cases here were live on agenticjobs.work at the same time, in one real
 * candidate's profile, and each defeated the redaction a different way: an
 * address in a section body was never looked at, and the candidate directory
 * served a cached headline that predated the parser fix.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTACT_WITHHELD, redactContactChannels } from '../dist/markup/resume.js';
import { nameOf, toCandidateSummary } from '../dist/core/candidates.js';

const ADDRESS = 'bb8654838@example.com';

test('an address in a section body is withheld, not only one in the preamble', () => {
  const source = [
    '# Athena',
    '',
    '**Operated by:** DevilX (' + ADDRESS + ')',
    '',
    '## Availability',
    'Full-time autonomous. Contact: ' + ADDRESS,
    '',
  ].join('\n');

  const { markdown, redacted } = redactContactChannels(source);

  assert.equal(redacted, true);
  assert.ok(!markdown.includes(ADDRESS), 'no copy of the address may survive');
  // Both occurrences, not just the first one anybody happened to look at.
  assert.equal(markdown.split(CONTACT_WITHHELD).length - 1, 2);
  assert.match(markdown, /Full-time autonomous/);
});

test('every address on a line is withheld, not just the first', () => {
  const source = `# X\n\n## Contact\nReach a@example.com or b@example.com today\n`;
  const { markdown } = redactContactChannels(source);
  assert.ok(!markdown.includes('a@example.com'));
  assert.ok(!markdown.includes('b@example.com'));
});

test('a phone number in a section body is withheld like an address', () => {
  const source = [
    '# Athena',
    '',
    '- **Location**: Remote',
    '',
    '## Availability',
    '',
    'Full-time autonomous. Call +1 555 123 4567 or (555) 123-4567, office hours only.',
  ].join('\n');

  const { markdown, redacted } = redactContactChannels(source);

  assert.equal(redacted, true);
  assert.ok(!markdown.includes('555 123 4567'), 'the +1 number is gone');
  assert.ok(!markdown.includes('(555) 123-4567'), 'the parenthesised number is gone');
  assert.ok(markdown.includes('Full-time autonomous'), 'the prose around it stays');
});

test('a plain 3-3-4 number in prose is withheld', () => {
  const source = '# X\n\n## Contact\nReach me on 555-123-4567 after 6.\n';
  const { markdown, redacted } = redactContactChannels(source);
  assert.equal(redacted, true);
  assert.ok(!markdown.includes('555-123-4567'));
});

test('a date range in prose is not mistaken for a phone number', () => {
  const source = [
    '# X',
    '',
    '## Experience',
    '',
    'Worked there 2019-01-01 - 2024-12-31, then 2025 onwards.',
  ].join('\n');
  const { markdown, redacted } = redactContactChannels(source);
  assert.equal(redacted, false);
  assert.equal(markdown, source);
});

test('a year range and a short id in prose are not mistaken for a phone number', () => {
  const source = '# X\n\n## Experience\nWorked 2019-2024. Order 12345 shipped. Ticket 9-5.\n';
  const { markdown, redacted } = redactContactChannels(source);
  assert.equal(redacted, false);
  assert.equal(markdown, source);
});

/**
 * The global-regex trap.
 *
 * `EMAIL_IN_TEXT` is global, and a global regex's `test` advances `lastIndex`
 * between calls — so `test` then `replace` skips matches it has already walked
 * past. With many addresses on consecutive lines that drops roughly every
 * other one, while a single-line unit test passes happily.
 */
test('consecutive lines each get redacted, with no lastIndex carry-over', () => {
  const lines = ['# X', '', '## Contact'];
  for (let i = 0; i < 10; i++) lines.push(`person${i}@example.com`);
  const { markdown } = redactContactChannels(lines.join('\n'));

  for (let i = 0; i < 10; i++) {
    assert.ok(!markdown.includes(`person${i}@example.com`), `person${i} survived`);
  }
});

test('a channel whose bold closes after the colon is withheld', () => {
  // The contact pair parser split on the colon inside the bold and left the
  // closing `**` attached to the value. `hrefFor` then saw "** +49 ...",
  // produced no href, and the field counted as a plain fact — so a phone
  // number or profile URL in the most common bold style went out to
  // signed-out readers verbatim. Only an email survived, and only because
  // the body scrub happened to catch the address inside it.
  const source = [
    '# Ada',
    '',
    '- **Tel:** +49 170 5551234',
    '- **Web:** example.com/ada',
    '- **Location**: London',
    '',
  ].join('\n');

  const { markdown, redacted } = redactContactChannels(source);
  assert.equal(redacted, true);
  assert.ok(!markdown.includes('5551234'), 'the phone number is gone');
  assert.ok(!markdown.includes('example.com/ada'), 'the profile URL is gone');
  assert.ok(markdown.includes('London'), 'a plain fact stays');
});

test('a resume with no address is returned untouched', () => {
  const source = '# X\n\n- **Location**: Remote\n\n## Summary\nNothing to hide.\n';
  const { markdown, redacted } = redactContactChannels(source);
  assert.equal(redacted, false);
  assert.equal(markdown, source);
});

/**
 * The stale cache.
 *
 * `parsed` is written on save, so a parser fix does not repair rows already in
 * the table. The directory kept serving the old headline — with the markup and
 * the address in it — from correct code reading a stale value.
 */
test('a cached headline holding an address is dropped at render time', () => {
  const summary = toCandidateSummary({
    id: 'r1',
    userId: 'u1',
    slug: 'athena',
    title: 'Athena',
    markdown: '# Athena\n',
    parsed: {
      name: 'Athena',
      headline: `Operated by:** DevilX (${ADDRESS})`,
      contact: [],
      sections: [],
      markdown: '',
      warnings: [],
    },
    visibility: 'public',
    publicSlug: 'athena',
    sourceName: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  } as never);

  assert.equal(summary.headline, null);
});

test('an address in the name line is withheld, not passed through as the h1', () => {
  const source = `# Jane Doe ${ADDRESS}\n\n- **Location**: Berlin\n\n## Summary\nText.\n`;
  const { markdown, redacted } = redactContactChannels(source);

  assert.equal(redacted, true);
  assert.ok(!markdown.includes(ADDRESS), 'the h1 must not carry the address');
  assert.match(markdown, new RegExp(`^# Jane Doe ${CONTACT_WITHHELD}$`, 'm'));
});

test('an address in a section heading is withheld', () => {
  const source = `# Jane\n\n- **Location**: Berlin\n\n## Contact me at ${ADDRESS}\nText.\n`;
  const { markdown, redacted } = redactContactChannels(source);

  assert.equal(redacted, true);
  assert.ok(!markdown.includes(ADDRESS), 'the h2 must not carry the address');
});

test('an address in a plain-fact contact bullet is withheld', () => {
  const source = `# Jane\n\n- **Location**: Berlin\n- **Note**: mail me at ${ADDRESS} anytime\n\n## Summary\nOk.\n`;
  const { markdown, redacted } = redactContactChannels(source);

  assert.equal(redacted, true);
  assert.ok(!markdown.includes(ADDRESS), 'a bullet without an href must not carry the address');
  assert.match(markdown, /- \*\*Note\*\*: mail me at /, 'the fact itself stays');
});

test('a name holding an address is dropped on the directory card', () => {
  const summary = toCandidateSummary({
    id: 'r1',
    userId: 'u1',
    slug: 'jane',
    title: 'Jane Doe',
    markdown: '# x\n',
    parsed: {
      name: `Jane Doe ${ADDRESS}`,
      headline: null,
      contact: [],
      sections: [],
      markdown: '',
      warnings: [],
    },
    visibility: 'public',
    publicSlug: 'jane',
    sourceName: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  } as never);

  assert.equal(summary.name, 'Jane Doe');
});

test('a phone in the name line is dropped on the directory card', () => {
  const summary = toCandidateSummary({
    id: 'r1',
    userId: 'u1',
    slug: 'jane',
    title: 'Jane Doe',
    markdown: '# x\n',
    parsed: {
      name: 'Jane Doe +1 (408) 555-0100',
      headline: null,
      contact: [],
      sections: [],
      markdown: '',
      warnings: [],
    },
    visibility: 'public',
    publicSlug: 'jane',
    sourceName: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  } as never);

  assert.equal(summary.name, 'Jane Doe');
});

test('a phone in the headline is dropped from the directory card', () => {
  const summary = toCandidateSummary({
    id: 'r1',
    userId: 'u1',
    slug: 'jane',
    title: 'Jane Doe',
    markdown: '# Jane Doe\n',
    parsed: {
      name: 'Jane Doe',
      headline: 'Call me at +1 (408) 555-0100',
      contact: [],
      sections: [],
      markdown: '',
      warnings: [],
    },
    visibility: 'public',
    publicSlug: 'jane',
    sourceName: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  } as never);

  assert.equal(summary.headline, null);
});

test('a title holding an address is not the fallback either', () => {
  const name = nameOf({
    id: 'r1',
    userId: 'u1',
    slug: 'jane',
    title: `Reach me at ${ADDRESS}`,
    markdown: '# x\n',
    parsed: { name: null, headline: null, contact: [], sections: [], markdown: '', warnings: [] },
    visibility: 'public',
    publicSlug: 'jane',
    sourceName: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  } as never);

  assert.equal(name, 'Candidate');
});

test('a cached headline with stray markup is cleaned, not dropped', () => {
  const summary = toCandidateSummary({
    id: 'r1',
    userId: 'u1',
    slug: 'x',
    title: 'X',
    markdown: '# X\n',
    parsed: {
      name: 'X',
      headline: 'Security agent** for hire',
      contact: [],
      sections: [],
      markdown: '',
      warnings: [],
    },
    visibility: 'public',
    publicSlug: 'x',
    sourceName: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  } as never);

  assert.equal(summary.headline, 'Security agent for hire');
});
