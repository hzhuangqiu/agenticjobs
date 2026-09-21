/**
 * The TUI's inbox and agents tabs, rendered for real to text.
 *
 * hqtui's renderToText draws the actual layout with no terminal, so these
 * assert on what a person would see rather than on the state alone.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToText } from '@profullstack/hqtui';
import { render } from '../src/tui/views.ts';
import { initialState, keyHints, nextTab, TABS, type TuiState } from '../src/tui/state.ts';

const draw = (state: TuiState): string =>
  renderToText(({ ui, theme }) => render(ui, theme, state), { width: 100, height: 30 });

const signedIn = (): TuiState => ({ ...initialState('https://board.test'), signedIn: true });

test('the inbox is a tab, with its unread count on the label', () => {
  const state: TuiState = {
    ...signedIn(),
    tab: 'inbox',
    unread: 2,
    threads: [
      {
        id: 't1',
        subject: 'Rust engineer',
        with: { kind: 'employer', name: 'Acme', slug: 'acme' },
        lastMessageAt: new Date().toISOString(),
        unread: 2,
        preview: 'Can you start Monday?',
        job: null,
      },
      {
        id: 't2',
        subject: 'Invoice',
        with: { kind: 'candidate', name: 'Dana', slug: 'dana' },
        lastMessageAt: new Date().toISOString(),
        unread: 0,
        preview: 'Paid.',
        job: null,
      },
    ],
  };
  const text = draw(state);
  assert.ok(TABS.includes('inbox'));
  assert.match(text, /Inbox \(2\)/);
  assert.match(text, /Acme\s+-\s+Rust engineer/);
  assert.match(text, /2 new/);
  assert.match(text, /Dana/);
  assert.ok(keyHints(state).some((hint) => hint.label === 'read'));
});

test('an open conversation shows its messages and offers a reply', () => {
  const state: TuiState = {
    ...signedIn(),
    tab: 'inbox',
    thread: {
      id: 't1',
      subject: 'Rust engineer',
      with: { kind: 'employer', name: 'Acme', slug: 'acme' },
      messages: [
        {
          id: 'm1',
          kind: 'text',
          body: 'Can you start Monday?',
          invoiceId: null,
          createdAt: new Date().toISOString(),
          sender: { name: 'Acme' },
          mine: false,
        },
        {
          id: 'm2',
          kind: 'text',
          body: 'Tuesday works better.',
          invoiceId: null,
          createdAt: new Date().toISOString(),
          sender: { name: 'Me' },
          mine: true,
        },
      ],
      invoices: [],
    },
  };
  const text = draw(state);
  assert.match(text, /Can you start Monday\?/);
  assert.match(text, /You/);
  assert.match(text, /Tuesday works better\./);
  assert.ok(keyHints(state).some((hint) => hint.key === 'm' && hint.label === 'reply'));
});

test('a prompt draws what is typed and takes over the key hints', () => {
  const state: TuiState = {
    ...signedIn(),
    tab: 'agents',
    prompt: {
      kind: 'agent-skills',
      label: 'Skills for Reviewer, comma separated (required)',
      value: 'rust, code rev',
      draft: { name: 'Reviewer' },
    },
  };
  const text = draw(state);
  assert.match(text, /Skills for Reviewer/);
  assert.match(text, /rust, code rev_/);
  assert.deepEqual(
    keyHints(state).map((hint) => hint.key),
    ['enter', 'esc'],
  );
});

test('the agents tab lists skills and who operates whom, and says how to register', () => {
  const empty: TuiState = { ...signedIn(), tab: 'agents' };
  assert.match(draw(empty), /Press n to register one/);

  const state: TuiState = {
    ...empty,
    agents: [
      {
        id: 'a1',
        slug: 'dispatcher',
        name: 'Dispatcher',
        skills: ['planning', 'triage'],
        description: '',
        url: null,
        public: true,
        operator: null,
        operates: [{ slug: 'reviewer', name: 'Reviewer' }],
        owner: { name: 'Me', candidateSlug: null },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'a2',
        slug: 'reviewer',
        name: 'Reviewer',
        skills: ['rust', 'code review'],
        description: '',
        url: null,
        public: false,
        operator: { slug: 'dispatcher', name: 'Dispatcher' },
        operates: [],
        owner: { name: 'Me', candidateSlug: null },
        createdAt: '',
        updatedAt: '',
      },
    ],
  };
  const text = draw(state);
  assert.match(text, /Dispatcher\s+-\s+planning, triage/);
  assert.match(text, /operates 1/);
  assert.match(text, /Reviewer\s+-\s+rust, code review\s+\(via Dispatcher\)/);
  assert.match(text, /private/);
  assert.ok(keyHints(state).some((hint) => hint.key === 'n' && hint.label === 'register'));
});

test('tab cycles through every tab and closes whatever was open', () => {
  let state: TuiState = { ...signedIn(), tab: 'find', detail: {} as never };
  const seen: string[] = [];
  for (let i = 0; i < TABS.length; i += 1) {
    state = nextTab(state, 1);
    seen.push(state.tab);
  }
  assert.deepEqual(seen, ['inbox', 'drafts', 'listings', 'agents', 'boards', 'find']);
  assert.equal(state.detail, null);
});
