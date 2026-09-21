/**
 * Watches, notifications and rankings from a terminal.
 *
 *   watch <words> [--remote --agents --tag t --workplace w ...] [--no-email]
 *   watches
 *   unwatch <id>
 *   notifications [--unread] [--read]
 *   popular [--period week|month|all] [--board applied]
 *   profitable [--period ...]
 */

import type { BoardClient, NotificationRecord, WatchRecord } from '../client/client.ts';
import type { JobQuery } from '../schema/index.ts';
import { ago } from '../schema/text.ts';
import { flagBool, flagString, type Args } from './args.ts';
import { bold, dim } from './format.ts';

export function watchLine(watch: WatchRecord): string {
  return `${bold(watch.label)}  ${dim(watch.id)}\n  ${watch.path}${watch.email ? '' : dim('  (no email)')}${
    watch.lastNotifiedAt === null ? '' : dim(`  last ${ago(watch.lastNotifiedAt)}`)
  }`;
}

export function notificationLine(item: NotificationRecord): string {
  return `${item.readAt === null ? bold(item.title) : item.title}  ${dim(ago(item.createdAt))}\n  ${item.body}${
    item.url === null ? '' : `\n  ${dim(item.url)}`
  }`;
}

export async function runWatch(
  args: Args,
  client: BoardClient,
  query: Partial<JobQuery>,
  out: (human: string, machine: unknown) => number,
): Promise<number> {
  const { limit: _limit, ...search } = query;
  void _limit;
  if (Object.keys(search).length === 0) {
    process.stderr.write(
      'agenticjobs watch <words> [--remote] [--agents] [--tag <t>] [--workplace <w>] [--min <n>] [--no-email]\n\nSay what to watch for; a watch on everything is the feed.\n',
    );
    return 1;
  }
  const result = await client.watch(search, { email: !flagBool(args, 'no-email') });
  return out(
    `${result.created ? 'Watching' : 'Already watching'} ${watchLine(result.watch)}\n${dim(
      'You will be told on the board' +
        (result.watch.email ? ' and by email' : '') +
        ' when a matching listing is published.',
    )}`,
    result,
  );
}

export async function runWatches(
  client: BoardClient,
  out: (human: string, machine: unknown) => number,
): Promise<number> {
  const result = await client.watches();
  if (result.items.length === 0)
    return out('Not watching anything. agenticjobs watch rust --remote', result);
  return out(result.items.map(watchLine).join('\n\n'), result);
}

export async function runUnwatch(
  args: Args,
  client: BoardClient,
  out: (human: string, machine: unknown) => number,
): Promise<number> {
  const id = args.positional[0] ?? '';
  if (id === '') {
    process.stderr.write('agenticjobs unwatch <id>   (ids are in: agenticjobs watches)\n');
    return 1;
  }
  const result = await client.unwatch(id);
  return out('Stopped watching.', result);
}

export async function runNotifications(
  args: Args,
  client: BoardClient,
  out: (human: string, machine: unknown) => number,
): Promise<number> {
  const unreadOnly = flagBool(args, 'unread');
  const result = await client.notifications({ unreadOnly });
  if (flagBool(args, 'read')) await client.markNotificationsRead();
  if (result.items.length === 0)
    return out(unreadOnly ? 'Nothing unread.' : 'No notifications yet.', result);
  const head =
    result.unread === 0
      ? ''
      : `${bold(`${result.unread} unread`)}${flagBool(args, 'read') ? dim(', now marked read') : dim('  (--read marks them read)')}\n\n`;
  return out(head + result.items.map(notificationLine).join('\n\n'), result);
}

export async function runRankings(
  args: Args,
  client: BoardClient,
  board: 'popular' | 'profitable',
  out: (human: string, machine: unknown) => number,
): Promise<number> {
  const period = flagString(args, 'period') ?? 'month';
  const wanted = board === 'popular' && flagString(args, 'board') === 'applied' ? 'applied' : board;
  const result = await client.rankings({ board: wanted, period, limit: 25 });
  const first = result.boards[0];
  if (first === undefined || first.rows.length === 0) {
    return out(`Nothing to rank ${period === 'all' ? 'yet' : `this ${period}`}.`, result);
  }
  const width = Math.max(...first.rows.map((row) => row.display.length));
  const lines = first.rows.map(
    (row) =>
      `${String(row.rank ?? '').padStart(3)}  ${row.display.padStart(width)}  ${row.name}  ${dim(row.slug)}`,
  );
  return out(
    `${bold(first.label)} ${dim(`(${first.unit.toLowerCase()}, ${period})`)}\n${lines.join('\n')}`,
    result,
  );
}
