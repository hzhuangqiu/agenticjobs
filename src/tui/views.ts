/**
 * The screens, as pure functions.
 *
 * Each takes the hqtui container and one state object and draws. No network,
 * no timers, no reading the clock beyond what the state carries - which is
 * what lets a test render the real layout to text and assert on it.
 */

import { fill, type Container, type Theme } from '@profullstack/hqtui';
import { ago } from '../schema/text.ts';
import { formatMethod, formatPay, formatPayShort, payOfJob } from '../schema/pay.ts';
import { toPlainText } from '../markup/markdown.ts';
import {
  keyHints,
  selectedIndex,
  TABS,
  tabLabel,
  type AgentRow,
  type ApplicationRow,
  type Job,
  type ThreadDetail,
  type TuiState,
} from './types.ts';

export function render(ui: Container, theme: Theme, state: TuiState): void {
  ui.statusBar({
    items: [
      { label: 'agenticjobs', active: true },
      { label: state.server.replace(/^https?:\/\//, '') },
      ...(state.signedIn ? [] : [{ label: 'not signed in', color: theme.warning }]),
    ],
    right: [
      { label: state.tab },
      ...(state.busy === null ? [] : [{ label: state.busy, color: theme.accent }]),
    ],
  });

  ui.tabs({
    tabs: TABS.map((tab) => tabLabel(state, tab)),
    active: TABS.indexOf(state.tab),
    variant: 'underline',
  });

  if (state.error !== null) {
    ui.text([{ text: ' ! ', bg: theme.danger }, { text: ` ${state.error}` }]);
  } else if (state.message !== null) {
    ui.label(` ${state.message}`);
  }

  if (state.detail !== null) {
    // Applications first: their presence is what makes the open listing yours,
    // which is a different screen from one you could apply to.
    if (state.applications !== null) {
      listingApplications(ui, theme, state.detail, state.applications);
    } else {
      jobDetail(ui, theme, state.detail);
    }
  } else if (state.thread !== null) {
    threadDetail(ui, theme, state.thread);
  } else if (state.agent !== null) {
    agentDetail(ui, theme, state.agent);
  } else {
    switch (state.tab) {
      case 'find':
        findTab(ui, theme, state);
        break;
      case 'inbox':
        inboxTab(ui, theme, state);
        break;
      case 'drafts':
        draftsTab(ui, theme, state);
        break;
      case 'listings':
        listingsTab(ui, theme, state);
        break;
      case 'agents':
        agentsTab(ui, theme, state);
        break;
      case 'boards':
        boardsTab(ui, theme, state);
        break;
    }
  }

  if (state.prompt !== null) {
    ui.panel({ title: state.prompt.label }, (panel) => {
      panel.text(`${state.prompt?.value ?? ''}_`);
    });
  }

  ui.statusBar({ items: keyHints(state).map((hint) => ({ key: hint.key, label: hint.label })) });
}

function inboxTab(ui: Container, theme: Theme, state: TuiState): void {
  if (!state.signedIn) {
    ui.panel({ title: 'Inbox' }, (panel) => {
      panel.label('Sign in to read your conversations: agenticjobs login');
    });
    return;
  }
  if (state.threads.length === 0) {
    ui.panel({ title: 'Inbox' }, (panel) => {
      panel.label('Nothing here yet.');
      panel.label('People reach you through the inbox; there is no public commenting.');
      panel.label('Start one: agenticjobs message <employer-slug> <text>');
    });
    return;
  }
  ui.panel(
    {
      title: `Inbox (${state.threads.length}${state.unread === 0 ? '' : `, ${state.unread} unread`})`,
      size: fill,
    },
    (panel) => {
      panel.list({
        items: state.threads.map((thread) => ({
          label: `${thread.unread > 0 ? `[${thread.unread} new] ` : ''}${thread.with.name}  -  ${thread.subject}  ${ago(thread.lastMessageAt)}`,
          color: thread.unread > 0 ? theme.accent : undefined,
        })),
        selected: state.threadIndex,
        followSelection: true,
        scrollbar: true,
      });
    },
  );
}

function threadDetail(ui: Container, theme: Theme, thread: ThreadDetail): void {
  ui.heading(thread.subject === '' ? `With ${thread.with.name}` : thread.subject);
  ui.label(
    `with ${thread.with.name}${thread.with.slug === null ? '' : ` (${thread.with.kind} ${thread.with.slug})`}`,
  );
  ui.panel({ title: `Messages (${thread.messages.length})`, size: fill }, (panel) => {
    const lines = thread.messages.map(
      (message) =>
        `${message.mine ? 'You' : message.sender.name}  ${ago(message.createdAt)}${message.kind === 'invoice' ? '  (invoice)' : ''}\n${message.body}`,
    );
    panel.text(lines.join('\n\n'), { wrap: true });
  });
  if (thread.invoices.length > 0) {
    ui.keyValues(
      thread.invoices.map((invoice) => ({
        label: `Invoice ${invoice.id.slice(0, 8)}`,
        value: `$${invoice.amountUsd} ${invoice.currency}  ${invoice.status}`,
        color: invoice.status === 'paid' ? theme.success : theme.warning,
      })),
    );
  }
}

function agentsTab(ui: Container, theme: Theme, state: TuiState): void {
  if (!state.signedIn) {
    ui.panel({ title: 'Your agents' }, (panel) => {
      panel.label('Sign in to register the agents you operate: agenticjobs login');
    });
    return;
  }
  ui.panel({ title: 'The agents you operate' }, (panel) => {
    panel.label('You are their sysop. Each one says what it is good at; that list is required.');
  });
  if (state.agents.length === 0) {
    ui.panel({ title: 'Your agents' }, (panel) => {
      panel.label('None registered. Press n to register one.');
    });
    return;
  }
  ui.panel({ title: `Your agents (${state.agents.length})`, size: fill }, (panel) => {
    panel.list({
      items: state.agents.map((agent) => ({
        label: `${agent.name}  -  ${agent.skills.join(', ')}${agent.operator === null ? '' : `  (via ${agent.operator.name})`}${
          agent.operates.length > 0 ? `  operates ${agent.operates.length}` : ''
        }${agent.public ? '' : '  private'}`,
        color: agent.public ? undefined : theme.muted,
      })),
      selected: state.agentIndex,
      followSelection: true,
      scrollbar: true,
    });
  });
}

function agentDetail(ui: Container, theme: Theme, agent: AgentRow): void {
  ui.heading(agent.name);
  ui.label(agent.slug);
  ui.keyValues([
    { label: 'Skills', value: agent.skills.join(', ') },
    {
      label: 'Operated by',
      value: agent.operator === null ? 'you, directly' : agent.operator.name,
    },
    {
      label: 'Operates',
      value: agent.operates.length === 0 ? '-' : agent.operates.map((a) => a.name).join(', '),
    },
    {
      label: 'Listed',
      value: agent.public ? 'public directory' : 'private',
      color: agent.public ? theme.success : theme.muted,
    },
    { label: 'Lives at', value: agent.url ?? '-' },
  ]);
  ui.panel({ title: 'What it does', size: fill }, (panel) => {
    panel.text(
      agent.description === ''
        ? 'Nothing written yet. agenticjobs agents update ' + agent.slug + ' --description "..."'
        : toPlainText(agent.description, 4000),
      { wrap: true },
    );
  });
}

function findTab(ui: Container, theme: Theme, state: TuiState): void {
  ui.panel({ title: state.editing ? 'Search (enter to run)' : 'Search' }, (panel) => {
    panel.text(state.query === '' ? (state.editing ? '_' : 'press / to search') : state.query);
  });

  if (state.jobs.length === 0) {
    ui.panel({ title: 'Jobs' }, (panel) => {
      panel.label('Nothing here.');
      panel.label('This board only holds listings posted to it, so that means');
      panel.label('nobody posted one, not that a crawler missed it.');
    });
    return;
  }

  ui.panel({ title: `Jobs (${state.jobs.length} of ${state.jobsTotal})`, size: fill }, (panel) => {
    panel.list({
      items: state.jobs.map((job) => ({
        label: jobRow(job),
        badge: job.agentPolicy === 'welcome' ? 'agents' : undefined,
        color: job.agentPolicy === 'human-only' ? theme.muted : undefined,
      })),
      selected: state.jobIndex,
      followSelection: true,
      scrollbar: true,
    });
  });
}

function jobRow(job: Job): string {
  const salary = formatPayShort(payOfJob(job));
  const bits = [job.org.name, job.workplace, salary ?? '', ago(job.publishedAt)].filter(
    (bit) => bit !== '',
  );
  return `${job.title}  -  ${bits.join(' | ')}`;
}

function jobDetail(ui: Container, theme: Theme, job: Job): void {
  ui.heading(job.title);
  ui.label(`${job.org.name}${job.location === null ? '' : ` - ${job.location}`}`);

  ui.keyValues([
    {
      label: 'Where',
      value: `${job.workplace}${job.location === null ? '' : `, ${job.location}`}`,
    },
    { label: 'Type', value: job.employmentType },
    { label: 'Level', value: job.seniority ?? 'unspecified' },
    {
      label: 'Pay',
      value: [formatPay(payOfJob(job)) ?? 'not listed', formatMethod(payOfJob(job).method)]
        .filter((bit): bit is string => bit !== null)
        .join(', '),
    },
    {
      label: 'Agents',
      value: agentPolicyText(job.agentPolicy),
      color:
        job.agentPolicy === 'welcome'
          ? theme.success
          : job.agentPolicy === 'human-only'
            ? theme.muted
            : theme.warning,
    },
    { label: 'Stack', value: job.stack.join(', ') || '-' },
    { label: 'Apply', value: job.apply.via },
  ]);

  ui.panel({ title: 'The listing', size: fill }, (panel) => {
    // The description is Markdown; the terminal gets it flattened rather than
    // half-rendered, because a half-rendered heading reads worse than none.
    panel.text(toPlainText(job.description, 4000), { wrap: true });
  });
}

function agentPolicyText(policy: string): string {
  if (policy === 'welcome') return 'welcome, no disclosure asked';
  if (policy === 'human-only') return 'asks for a human-written application';
  return 'welcome if disclosed';
}

/**
 * What came back to one of your listings: the "read what came back" half of
 * the TUI, opened with enter on the Your listings tab. One row per
 * application, newest first as the API returns them.
 */
function listingApplications(
  ui: Container,
  theme: Theme,
  job: Job,
  applications: ApplicationRow[],
): void {
  ui.heading(job.title);
  ui.label(`${job.org.name} - posted ${ago(job.publishedAt)}`);

  if (applications.length === 0) {
    ui.panel({ title: 'Applications', size: fill }, (panel) => {
      panel.label('Nobody yet.');
    });
    return;
  }

  ui.panel({ title: `Applications (${applications.length})`, size: fill }, (panel) => {
    panel.list({
      items: applications.map((application) => {
        const name = application.answers['name']?.trim() || 'Someone';
        const email = application.answers['email']?.trim();
        const agent =
          application.agent === null
            ? ''
            : ` | agent: ${application.agent.name}${application.agent.supervised ? ' (supervised)' : ''}`;
        return {
          label: `${name}${email === undefined || email === '' ? '' : ` <${email}>`} | ${ago(application.createdAt)}${agent}`,
          badge: application.status,
          color:
            application.status === 'hired'
              ? theme.success
              : application.status === 'rejected'
                ? theme.muted
                : undefined,
        };
      }),
      selected: 0,
      followSelection: false,
      scrollbar: true,
    });
  });
}


function draftsTab(ui: Container, theme: Theme, state: TuiState): void {
  ui.panel({ title: 'Prepared, not sent' }, (panel) => {
    panel.label('An agent can write these. You decide which ones go out.');
  });

  if (state.drafts.length === 0) {
    ui.panel({ title: 'Drafts' }, (panel) => {
      panel.label('Nothing waiting.');
      panel.label('Open a job and press d to prepare one.');
    });
    return;
  }

  ui.panel({ title: `Drafts (${state.drafts.length})`, size: fill }, (panel) => {
    panel.list({
      items: state.drafts.map((draft) => ({
        label: `${draft.jobTitle}   ${ago(draft.createdAt)}`,
        color: theme.accent,
      })),
      selected: state.draftIndex,
      followSelection: true,
      scrollbar: true,
    });
  });
}

function listingsTab(ui: Container, theme: Theme, state: TuiState): void {
  if (!state.canPost) {
    ui.panel({ title: 'Your listings' }, (panel) => {
      panel.label('No employer on this account yet, so there is nothing to post under.');
      panel.label('Add one in a browser, or with the API, then come back.');
    });
    return;
  }

  if (state.listings.length === 0) {
    ui.panel({ title: 'Your listings' }, (panel) => {
      panel.label('Nothing posted yet.');
      panel.label('agenticjobs post job.md');
    });
    return;
  }

  ui.panel({ title: `Your listings (${state.listings.length})`, size: fill }, (panel) => {
    panel.list({
      items: state.listings.map((job) => ({
        label: `${job.title}   ${job.org.name}`,
        badge: job.status,
        color: job.status === 'published' ? theme.success : theme.muted,
      })),
      selected: state.listingIndex,
      followSelection: true,
      scrollbar: true,
    });
  });
}

function boardsTab(ui: Container, theme: Theme, state: TuiState): void {
  ui.panel({ title: 'Boards you are signed in to' }, (panel) => {
    panel.label('One account per board. Search across all of them with: agenticjobs search --all');
  });

  if (state.boards.length === 0) {
    ui.panel({ title: 'Boards' }, (panel) => {
      panel.label('None yet. Run: agenticjobs login <url>');
    });
    return;
  }

  ui.panel({ title: 'Boards', size: fill }, (panel) => {
    panel.list({
      items: state.boards.map((board) => ({
        label: `${board.current ? '* ' : '  '}${board.name}   ${board.email ?? 'signed out'}`,
        color: board.current ? theme.accent : undefined,
      })),
      selected: state.boardIndex,
      followSelection: true,
    });
  });
}

export { selectedIndex };
