/**
 * The TUI's state, and the pure functions over it.
 *
 * Every view is a function of one of these objects and nothing else, which is
 * what lets hqtui's renderToText exercise the real layout in a test instead of
 * a reimplementation of it. Nothing here touches the network or the terminal.
 */

import type { Job } from '../schema/index.ts';
import type { AgentRecord } from '../client/client.ts';

export const TABS = ['find', 'inbox', 'drafts', 'listings', 'agents', 'boards'] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABELS: Record<Tab, string> = {
  find: 'Find work',
  inbox: 'Inbox',
  drafts: 'Drafts',
  listings: 'Your listings',
  agents: 'Your agents',
  boards: 'Boards',
};

export interface DraftRow {
  id: string;
  jobTitle: string;
  jobSlug: string;
  createdAt: string;
}

/**
 * What came back to one of your listings. The shape of one item of
 * `GET /api/v1/jobs/<slug>/applications`, which is also what the CLI's
 * `applications` command renders.
 */
export interface ApplicationRow {
  id: string;
  answers: Record<string, string>;
  agent: { name: string; supervised: boolean } | null;
  status: string;
  createdAt: string;
}

export interface BoardRow {
  server: string;
  name: string;
  email: string | null;
  current: boolean;
}

export interface ThreadRow {
  id: string;
  subject: string;
  with: { kind: string; name: string; slug: string | null };
  lastMessageAt: string;
  unread: number;
  preview: string;
  job: { slug: string; title: string } | null;
}

export interface ThreadMessage {
  id: string;
  kind: string;
  body: string;
  invoiceId: string | null;
  createdAt: string;
  sender: { name: string };
  mine: boolean;
}

export interface ThreadDetail {
  id: string;
  subject: string;
  with: { kind: string; name: string; slug: string | null };
  messages: ThreadMessage[];
  invoices: { id: string; amountUsd: string; currency: string; status: string }[];
}

export type AgentRow = AgentRecord;

/**
 * A line of input the screen is asking for: a reply, or one step of the
 * register-an-agent wizard. While one is open the keyboard types into it.
 */
export interface Prompt {
  kind: 'reply' | 'agent-name' | 'agent-skills' | 'agent-operator' | 'agent-remove';
  label: string;
  value: string;
  /** What the wizard has gathered so far. */
  draft: { name?: string; skills?: string[] };
}

export interface TuiState {
  tab: Tab;
  server: string;
  /** Set while a request is in flight, so the frame can say so. */
  busy: string | null;
  /** Shown in the status bar until the next action replaces it. */
  message: string | null;
  error: string | null;

  query: string;
  /** True while the search box has the keyboard. */
  editing: boolean;
  /** A line being typed for something other than the search. */
  prompt: Prompt | null;

  jobs: Job[];
  jobsTotal: number;
  jobIndex: number;
  /** Set when a listing is open over the list. */
  detail: Job | null;
  /**
   * Set only when the open detail is one of your own listings: the
   * applications it has received. Null on the find tab, where the open job is
   * one you could apply to - the two are different screens with different
   * keys, and an employer must never be offered "apply" against their own
   * listing.
   */
  applications: ApplicationRow[] | null;

  threads: ThreadRow[];
  threadIndex: number;
  unread: number;
  /** Set when a conversation is open over the inbox. */
  thread: ThreadDetail | null;

  drafts: DraftRow[];
  draftIndex: number;

  listings: Job[];
  listingIndex: number;

  agents: AgentRow[];
  agentIndex: number;
  /** Set when an agent is open over the list. */
  agent: AgentRow | null;

  boards: BoardRow[];
  boardIndex: number;

  /** True when the account can post, which changes what the help bar says. */
  canPost: boolean;
  signedIn: boolean;
}

export function initialState(server: string): TuiState {
  return {
    tab: 'find',
    server,
    busy: null,
    message: null,
    error: null,
    query: '',
    editing: false,
    prompt: null,
    jobs: [],
    jobsTotal: 0,
    jobIndex: 0,
    detail: null,
    applications: null,
    threads: [],
    threadIndex: 0,
    unread: 0,
    thread: null,
    drafts: [],
    draftIndex: 0,
    listings: [],
    listingIndex: 0,
    agents: [],
    agentIndex: 0,
    agent: null,
    boards: [],
    boardIndex: 0,
    canPost: false,
    signedIn: false,
  };
}

/** How many rows the active tab has, so movement can be written once. */
export function rowCount(state: TuiState): number {
  switch (state.tab) {
    case 'find':
      return state.jobs.length;
    case 'inbox':
      return state.threads.length;
    case 'drafts':
      return state.drafts.length;
    case 'listings':
      return state.listings.length;
    case 'agents':
      return state.agents.length;
    case 'boards':
      return state.boards.length;
  }
}

export function selectedIndex(state: TuiState): number {
  switch (state.tab) {
    case 'find':
      return state.jobIndex;
    case 'inbox':
      return state.threadIndex;
    case 'drafts':
      return state.draftIndex;
    case 'listings':
      return state.listingIndex;
    case 'agents':
      return state.agentIndex;
    case 'boards':
      return state.boardIndex;
  }
}

export function withSelection(state: TuiState, index: number): TuiState {
  // Clamped rather than wrapped: holding a cursor key past the end and
  // reappearing at the top is disorienting in a list you are reading.
  const count = rowCount(state);
  const next = count === 0 ? 0 : Math.min(count - 1, Math.max(0, index));
  switch (state.tab) {
    case 'find':
      return { ...state, jobIndex: next };
    case 'inbox':
      return { ...state, threadIndex: next };
    case 'drafts':
      return { ...state, draftIndex: next };
    case 'listings':
      return { ...state, listingIndex: next };
    case 'agents':
      return { ...state, agentIndex: next };
    case 'boards':
      return { ...state, boardIndex: next };
  }
}

export function move(state: TuiState, delta: number): TuiState {
  return withSelection(state, selectedIndex(state) + delta);
}

export function nextTab(state: TuiState, delta: number): TuiState {
  const index = TABS.indexOf(state.tab);
  const next = TABS[(index + delta + TABS.length) % TABS.length] ?? 'find';
  return closeOverlay({ ...state, tab: next });
}

/** Whatever is open over a list, if anything. */
export function hasOverlay(state: TuiState): boolean {
  return state.detail !== null || state.thread !== null || state.agent !== null;
}

export function closeOverlay(state: TuiState): TuiState {
  return { ...state, detail: null, applications: null, thread: null, agent: null, prompt: null };
}

export function selectedJob(state: TuiState): Job | null {
  if (state.tab === 'find') return state.jobs[state.jobIndex] ?? null;
  if (state.tab === 'listings') return state.listings[state.listingIndex] ?? null;
  return null;
}

export function selectedDraft(state: TuiState): DraftRow | null {
  return state.drafts[state.draftIndex] ?? null;
}

export function selectedBoard(state: TuiState): BoardRow | null {
  return state.boards[state.boardIndex] ?? null;
}

export function selectedThread(state: TuiState): ThreadRow | null {
  return state.threads[state.threadIndex] ?? null;
}

export function selectedAgent(state: TuiState): AgentRow | null {
  return state.agents[state.agentIndex] ?? null;
}

/** The label for a tab, with a count where one helps. */
export function tabLabel(state: TuiState, tab: Tab): string {
  const base = TAB_LABELS[tab];
  if (tab === 'drafts' && state.drafts.length > 0) return `${base} (${state.drafts.length})`;
  if (tab === 'inbox' && state.unread > 0) return `${base} (${state.unread})`;
  return base;
}

/** What the bottom bar offers, which differs per tab and per role. */
export function keyHints(state: TuiState): { key: string; label: string }[] {
  if (state.editing) {
    return [
      { key: 'enter', label: 'search' },
      { key: 'esc', label: 'cancel' },
    ];
  }
  if (state.prompt !== null) {
    return [
      { key: 'enter', label: state.prompt.kind === 'reply' ? 'send' : 'next' },
      { key: 'esc', label: 'cancel' },
    ];
  }
  const common = [
    { key: 'tab', label: 'switch' },
    { key: '/', label: 'search' },
    { key: 'r', label: 'reload' },
    { key: 'q', label: 'quit' },
  ];
  if (state.detail !== null) {
    if (state.applications !== null) {
      // Your own listing's applications: reading, not applying.
      return [
        { key: 'esc', label: 'back' },
        ...common,
      ];
    }
    return [
      { key: 'a', label: 'apply' },
      { key: 'd', label: 'prepare draft' },
      { key: 'esc', label: 'back' },
      ...common,
    ];
  }
  if (state.thread !== null) {
    return [{ key: 'm', label: 'reply' }, { key: 'esc', label: 'back' }, ...common];
  }
  if (state.agent !== null) {
    return [{ key: 'x', label: 'remove' }, { key: 'esc', label: 'back' }, ...common];
  }
  switch (state.tab) {
    case 'find':
      return [{ key: 'enter', label: 'open' }, ...common];
    case 'inbox':
      return [{ key: 'enter', label: 'read' }, ...common];
    case 'drafts':
      return [{ key: 'enter', label: 'send' }, { key: 'x', label: 'discard' }, ...common];
    case 'listings':
      return [
        { key: 'p', label: 'publish' },
        { key: 'c', label: 'close' },
        { key: 'enter', label: 'applications' },
        ...common,
      ];
    case 'agents':
      return [
        { key: 'n', label: 'register' },
        { key: 'enter', label: 'open' },
        { key: 'x', label: 'remove' },
        ...common,
      ];
    case 'boards':
      return [{ key: 'enter', label: 'use' }, ...common];
  }
}
