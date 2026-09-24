import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runNotifications } from '../dist/cli/watches.js';

test('notifications --read returns the updated unread count and read timestamps', async () => {
  const before = notification(null);
  const after = notification('2026-09-24T12:00:00.000Z');
  let reads = 0;
  const client = {
    async notifications() {
      reads += 1;
      return reads === 1 ? { items: [before], unread: 1 } : { items: [after], unread: 0 };
    },
    async markNotificationsRead() {
      return { read: 1 };
    },
  };
  let human = '';
  let machine: unknown;

  const code = await runNotifications(
    { command: 'notifications', positional: [], flags: { read: true } },
    client as never,
    (text, data) => {
      human = text;
      machine = data;
      return 0;
    },
  );

  assert.equal(code, 0);
  assert.match(human, /now marked read/);
  assert.deepEqual(machine, { items: [after], unread: 0 });
  assert.equal(reads, 2);
});

function notification(readAt: string | null) {
  return {
    id: 'notification-1',
    kind: 'watch',
    title: 'Rust engineer',
    body: 'A new remote job matched your watch.',
    url: '/jobs/rust-engineer',
    createdAt: '2026-09-24T11:00:00.000Z',
    readAt,
  };
}
