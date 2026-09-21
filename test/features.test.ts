/**
 * Agents, watches, landing pages and rankings, end to end against Postgres.
 *
 * Skipped when no database is reachable, like the other DB suites.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../dist/db/migrate.js';
import { createApp } from '../dist/server/app.js';
import { loadConfig } from '../dist/config.js';
import { createSession, ensureUser, SESSION_COOKIE } from '../dist/core/auth.js';
import { createOrg } from '../dist/core/orgs.js';

const database = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];

describe('agents, watches, landing pages and rankings', { skip: !database }, () => {
  const pool = new pg.Pool({ connectionString: database });
  const suffix = randomUUID().slice(0, 8);
  const sentMail: { to: string; subject: string; text: string }[] = [];
  const config = loadConfig({
    DATABASE_URL: database!,
    PUBLIC_URL: 'http://board.test',
    SECRET: 'features-test-secret',
  });
  const app = createApp(
    pool,
    config,
    {
      send: async (message: { to: string; subject: string; text: string }) => {
        sentMail.push(message);
        return true;
      },
    },
    null,
  );

  let ownerId = '';
  let otherId = '';
  let owner = '';
  let other = '';
  let orgSlug = '';
  const otherEmail = `features-other-${suffix}@example.test`;
  const tag = `rustlang${suffix}`;

  const request = (
    path: string,
    token = '',
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.fetch(
      new Request(`http://board.test${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual',
      }),
    );
  const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;
  const page = (path: string, token = '') =>
    app.fetch(
      new Request(`http://board.test${path}`, {
        headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
        redirect: 'manual',
      }),
    );

  const publish = async (title: string, extra: Record<string, unknown> = {}) => {
    const response = await request('/api/v1/jobs', owner, 'POST', {
      org: orgSlug,
      title,
      description: `A listing for ${title}, posted by the test.`,
      agentPolicy: 'welcome',
      workplace: 'remote',
      tags: [tag],
      pay: ['$150k a year'],
      publish: true,
      ...extra,
    });
    const body = await response.text();
    assert.equal(response.status, 201, body);
    return (JSON.parse(body) as { job: { id: string; slug: string } }).job;
  };

  before(async () => {
    await migrate(pool);
    const a = await ensureUser(pool, `features-owner-${suffix}@example.test`, 'Owner');
    const b = await ensureUser(pool, otherEmail, 'Other');
    ownerId = a.id;
    otherId = b.id;
    owner = await createSession(pool, a.id, { label: 'features test' });
    other = await createSession(pool, b.id, { label: 'features test' });
    const org = await createOrg(pool, a.id, { name: `Features Works ${suffix}` });
    if (typeof org === 'string') throw new Error(org);
    orgSlug = org.slug;
  });

  after(async () => {
    await pool.query('delete from users where id = any($1::uuid[])', [
      [ownerId, otherId].filter(Boolean),
    ]);
    await pool.query('delete from organisations where slug = $1', [orgSlug]);
    await pool.end();
  });

  test('an agent needs skills, belongs to its owner, and operators stay within one account', async () => {
    assert.equal(
      (await request('/api/v1/agents', '', 'POST', { name: 'Nobody', skills: ['x'] })).status,
      401,
    );

    const noSkills = await request('/api/v1/agents', owner, 'POST', {
      name: `Dispatcher ${suffix}`,
    });
    assert.equal(noSkills.status, 400);
    const problem = await json<{ error: { fields: { field: string }[] } }>(noSkills);
    assert.equal(problem.error.fields[0]?.field, 'skills');

    const created = await request('/api/v1/agents', owner, 'POST', {
      name: `Dispatcher ${suffix}`,
      skills: 'planning, Triage, planning',
    });
    assert.equal(created.status, 201, await created.clone().text());
    const dispatcher = await json<{
      agent: { slug: string; skills: string[]; operator: null };
      url: string;
    }>(created);
    assert.deepEqual(dispatcher.agent.skills, ['planning', 'triage']);
    assert.equal(dispatcher.url, `http://board.test/agents/${dispatcher.agent.slug}`);

    const reviewer = (
      await json<{ agent: { slug: string; operator: { name: string } | null } }>(
        await request('/api/v1/agents', owner, 'POST', {
          name: `Reviewer ${suffix}`,
          skills: ['rust'],
          operator: dispatcher.agent.slug,
        }),
      )
    ).agent;
    assert.equal(reviewer.operator?.name, `Dispatcher ${suffix}`);

    // Somebody else's agent cannot be named as an operator.
    const foreign = await request('/api/v1/agents', other, 'POST', {
      name: `Spy ${suffix}`,
      skills: ['x'],
      operator: dispatcher.agent.slug,
    });
    assert.equal(foreign.status, 400);

    // No cycles, no empty skill lists.
    assert.equal(
      (
        await request(`/api/v1/agents/${dispatcher.agent.slug}`, owner, 'PATCH', {
          operator: reviewer.slug,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/api/v1/agents/${reviewer.slug}`, owner, 'PATCH', { skills: [] })).status,
      400,
    );
    assert.equal(
      (await request(`/api/v1/agents/${reviewer.slug}`, other, 'PATCH', { name: 'Mine now' }))
        .status,
      404,
    );

    // Private agents are the owner's business.
    assert.equal(
      (await request(`/api/v1/agents/${reviewer.slug}`, owner, 'PATCH', { public: false })).status,
      200,
    );
    assert.equal((await request(`/api/v1/agents/${reviewer.slug}`)).status, 404);
    assert.equal((await request(`/api/v1/agents/${reviewer.slug}`, owner)).status, 200);
    const directory = await json<{ items: { slug: string }[] }>(
      await request('/api/v1/agents?skill=planning'),
    );
    assert.ok(directory.items.some((item) => item.slug === dispatcher.agent.slug));
    assert.ok(!directory.items.some((item) => item.slug === reviewer.slug));
    const mine = await json<{ items: { slug: string }[] }>(
      await request('/api/v1/me/agents', owner),
    );
    assert.equal(mine.items.length, 2);

    // One call names a sysop for several agents.
    const operates = await json<{ agent: { operates: { slug: string }[] } }>(
      await request(`/api/v1/agents/${dispatcher.agent.slug}/operates`, owner, 'POST', {
        agents: [reviewer.slug],
      }),
    );
    assert.deepEqual(
      operates.agent.operates.map((a) => a.slug),
      [reviewer.slug],
    );

    // Pages.
    const agentPage = await page(`/agents/${dispatcher.agent.slug}`);
    assert.equal(agentPage.status, 200);
    const html = await agentPage.text();
    assert.match(html, new RegExp(`Dispatcher ${suffix}`));
    assert.match(html, /planning/);
    assert.equal((await page('/agents')).status, 200);
    assert.equal((await page('/me/agents/new', owner)).status, 200);

    assert.equal(
      (await request(`/api/v1/agents/${dispatcher.agent.slug}`, other, 'DELETE')).status,
      404,
    );
    assert.equal((await request(`/api/v1/agents/${reviewer.slug}`, owner, 'DELETE')).status, 200);
    const after = await json<{ agent: { operates: unknown[] } }>(
      await request(`/api/v1/agents/${dispatcher.agent.slug}`),
    );
    assert.deepEqual(after.agent.operates, []);
  });

  test('a watch fires when a matching listing is published: a notification, and one email an hour', async () => {
    assert.equal((await request('/api/v1/watches', '', 'POST', { tags: tag })).status, 401);
    assert.equal(
      (await request('/api/v1/watches', other, 'POST', {})).status,
      400,
      'a watch on everything is the feed',
    );

    const created = await request('/api/v1/watches', other, 'POST', {
      tags: tag,
      workplace: 'remote',
    });
    assert.equal(created.status, 201, await created.clone().text());
    const watch = (
      await json<{ watch: { id: string; path: string; label: string }; created: boolean }>(created)
    ).watch;
    assert.equal(watch.path, `/${tag}/remote`);
    assert.equal(watch.label, `remote ${tag} jobs`);
    const again = await request('/api/v1/watches', other, 'POST', {
      query: `tags=${tag}&workplace=remote`,
    });
    assert.equal(again.status, 200);
    assert.equal((await json<{ created: boolean }>(again)).created, false);

    sentMail.length = 0;
    const first = await publish(`Rust engineer ${suffix}`);
    let notifications = await json<{ items: { title: string; url: string }[]; unread: number }>(
      await request('/api/v1/notifications', other),
    );
    assert.equal(notifications.unread, 1);
    assert.match(notifications.items[0]?.title ?? '', new RegExp(`Rust engineer ${suffix}`));
    assert.equal(notifications.items[0]?.url, `/jobs/${first.slug}`);
    assert.equal(sentMail.length, 1);
    assert.equal(sentMail[0]?.to, otherEmail);
    assert.match(sentMail[0]?.subject ?? '', new RegExp(`Rust engineer ${suffix}`));
    assert.match(sentMail[0]?.text ?? '', new RegExp(`http://board.test/jobs/${first.slug}`));
    assert.match(sentMail[0]?.text ?? '', new RegExp(`http://board.test/${tag}/remote`));

    // A second match within the hour is a notification, not a second email.
    await publish(`Rust compiler engineer ${suffix}`);
    notifications = await json(await request('/api/v1/notifications', other));
    assert.equal(notifications.unread, 2);
    assert.equal(sentMail.length, 1);

    // A listing the search would not have shown does not fire.
    await publish(`Onsite Rust ${suffix}`, { workplace: 'onsite' });
    notifications = await json(await request('/api/v1/notifications', other));
    assert.equal(notifications.unread, 2);

    const read = await json<{ read: number }>(
      await request('/api/v1/notifications/read', other, 'POST', {}),
    );
    assert.equal(read.read, 2);
    notifications = await json(await request('/api/v1/notifications', other));
    assert.equal(notifications.unread, 0);
    assert.equal(notifications.items.length, 2);

    const notificationsPage = await page('/notifications', other);
    assert.equal(notificationsPage.status, 200);
    const html = await notificationsPage.text();
    assert.match(html, new RegExp(`remote ${tag} jobs`));
    assert.match(html, /push-enable/);

    // The Watch button on a search page is a plain form.
    const home = await page(`/?tags=${tag}&workplace=remote`, other);
    assert.match(await home.text(), /Watch this search/);
    const anonymous = await page(`/${tag}/remote`);
    assert.match(await anonymous.text(), /Watch this search/);

    assert.equal((await request(`/api/v1/watches/${watch.id}`, other, 'DELETE')).status, 200);
    assert.equal((await request(`/api/v1/watches/${watch.id}`, other, 'DELETE')).status, 404);
  });

  test('a landing page is the search as a path, with one canonical form', async () => {
    const landing = await page(`/${tag}/remote`);
    assert.equal(landing.status, 200);
    const html = await landing.text();
    assert.match(html, new RegExp(`Remote ${tag.charAt(0).toUpperCase()}${tag.slice(1)} jobs`));
    assert.match(html, new RegExp(`rel="canonical" href="http://board.test/${tag}/remote"`));
    assert.match(html, new RegExp(`Rust engineer ${suffix}`));
    assert.doesNotMatch(html, new RegExp(`Onsite Rust ${suffix}`));

    const reordered = await page(`/remote/${tag}`);
    assert.equal(reordered.status, 301);
    assert.equal(reordered.headers.get('location'), `/${tag}/remote`);

    assert.equal((await page(`/${tag}/app.js`)).status, 404);
    assert.equal(
      (await page(`/nope-${suffix}`)).status,
      404,
      'a tag the board has never seen is not a page',
    );
    assert.equal((await page('/remote')).status, 200, 'a filter-only path always exists');
    assert.equal((await page(`/${tag}/remote/onsite`)).status, 404);
    assert.equal((await page('/candidates')).status, 200, 'a real route is never a landing page');

    const salary = await page('/120k+');
    assert.equal(salary.status, 200);
    assert.match(await salary.text(), /paying 120,000\+/);

    const skills = await page('/skills');
    assert.equal(skills.status, 200);
    assert.match(await skills.text(), new RegExp(`href="/${tag}"`));

    // The footer links the popular skills on every page.
    assert.match(
      await (await page('/docs')).text(),
      new RegExp(`Popular skills:[\\s\\S]*href="/${tag}"`),
    );
  });

  test('rankings count reads and rank stated annual pay', async () => {
    const jobs = await json<{ items: { slug: string }[] }>(
      await request(`/api/v1/jobs?tags=${tag}&workplace=remote`),
    );
    const slug = jobs.items.find((item) => item.slug.startsWith('rust-engineer'))?.slug;
    assert.ok(slug);
    assert.equal((await page(`/jobs/${slug}`)).status, 200);
    assert.equal((await page(`/jobs/${slug}`)).status, 200);
    assert.equal((await request(`/api/v1/jobs/${slug}`)).status, 200);

    const popular = await json<{
      boards: { id: string; rows: { slug: string; value: number }[] }[];
    }>(await request('/api/v1/rankings?board=popular&period=week&limit=100'));
    const row = popular.boards[0]?.rows.find((item) => item.slug === slug);
    assert.ok(row, 'the read listing is on the board');
    assert.equal(row.value, 3);

    const profitable = await json<{
      boards: { rows: { slug: string; value: number; display: string }[] }[];
    }>(await request('/api/v1/rankings?board=profitable&limit=100'));
    const paid = profitable.boards[0]?.rows.find((item) => item.slug === slug);
    assert.ok(paid, 'a listing stating an annual figure is ranked by pay');
    assert.equal(paid.value, 150_000 * 100);
    assert.equal(paid.display, '$150,000.00');

    assert.match(await (await page('/popular')).text(), /Most read/);
    assert.match(await (await page('/most-profitable')).text(), /Most profitable/);
    assert.equal((await page('/leaderboard')).status, 302);
    const feed = await page('/leaderboard/profitable.json?period=all&limit=100');
    assert.equal(feed.status, 200);
    assert.ok((await json<{ rows: { id: string }[] }>(feed)).rows.some((item) => item.id === slug));
    assert.equal((await page('/leaderboard/profitable.xml')).status, 200);
  });

  test('push keys are minted once and a browser can subscribe and unsubscribe', async () => {
    const key = await json<{ publicKey: string }>(await request('/api/v1/push/key'));
    assert.equal(Buffer.from(key.publicKey, 'base64url').length, 65);
    assert.equal(
      (await json<{ publicKey: string }>(await request('/api/v1/push/key'))).publicKey,
      key.publicKey,
    );

    const subscription = {
      endpoint: `https://push.example.test/send/${suffix}`,
      keys: { p256dh: key.publicKey, auth: Buffer.alloc(16, 7).toString('base64url') },
    };
    assert.equal(
      (await request('/api/v1/push/subscriptions', '', 'POST', subscription)).status,
      401,
    );
    assert.equal(
      (await request('/api/v1/push/subscriptions', other, 'POST', { endpoint: 'http://nope' }))
        .status,
      400,
    );
    assert.equal(
      (await request('/api/v1/push/subscriptions', other, 'POST', subscription)).status,
      201,
    );
    const count = await pool.query(
      'select count(*)::int as n from push_subscriptions where user_id = $1',
      [otherId],
    );
    assert.equal(count.rows[0]?.n, 1);
    const removed = await json<{ deleted: boolean }>(
      await request('/api/v1/push/subscriptions', other, 'DELETE', {
        endpoint: subscription.endpoint,
      }),
    );
    assert.equal(removed.deleted, true);
  });
});
