/**
 * Watches, notifications and push subscriptions: the API and the page.
 */

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../deps.ts';
import {
  createWatch,
  deleteWatch,
  listNotifications,
  listWatches,
  markNotificationsRead,
  unreadNotifications,
} from '../../core/watches.ts';
import {
  deleteSubscription,
  parseSubscription,
  pushKeys,
  saveSubscription,
  subscriptionCount,
} from '../../core/push.ts';
import { pathForQuery } from '../../core/landing.ts';
import { parseQuery } from '../../schema/query.ts';
import { Layout } from '../../views/layout.tsx';
import { NotificationsPage } from '../../views/notifications.tsx';
import { formOf, requireViewer, shell } from './pages.tsx';

type Ctx = Context<AppEnv>;

function signedIn(c: Ctx): { id: string } | Response {
  const viewer = c.get('viewer');
  if (viewer === null) {
    return c.json({ error: { code: 'unauthenticated', message: 'Sign in first.' } }, 401);
  }
  return viewer;
}

async function body(c: Ctx): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const parsed = (await c.req.json()) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    }
    return (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** A query from a body: either `query` as a querystring/object, or the fields themselves. */
function queryOf(input: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  const source = input['query'] ?? input;
  if (typeof source === 'string') return new URLSearchParams(source.replace(/^[?/]+/, ''));
  if (typeof source === 'object' && source !== null) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (Array.isArray(value)) params.set(key, value.map(String).join(','));
      else if (value !== null && value !== undefined && value !== '')
        params.set(key, String(value));
    }
  }
  return params;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function watchRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // --- API ------------------------------------------------------------------

  routes.get('/api/v1/watches', async (c) => {
    const viewer = signedIn(c);
    if (viewer instanceof Response) return viewer;
    c.header('cache-control', 'private, no-store');
    const items = await listWatches(c.get('deps').pool, viewer.id, pathForQuery);
    return c.json({ items, total: items.length });
  });

  routes.post('/api/v1/watches', async (c) => {
    const viewer = signedIn(c);
    if (viewer instanceof Response) return viewer;
    const input = await body(c);
    const query = parseQuery(queryOf(input));
    const email =
      input['email'] === undefined
        ? true
        : input['email'] !== false && input['email'] !== 'false' && input['email'] !== 'off';
    const result = await createWatch(c.get('deps').pool, viewer.id, query, { email }, pathForQuery);
    if (typeof result === 'string') {
      return c.json({ error: { code: 'invalid', message: result } }, 400);
    }
    return c.json({ watch: result.watch, created: result.created }, result.created ? 201 : 200);
  });

  routes.delete('/api/v1/watches/:id', async (c) => {
    const viewer = signedIn(c);
    if (viewer instanceof Response) return viewer;
    const id = c.req.param('id');
    const deleted = isUuid(id) && (await deleteWatch(c.get('deps').pool, viewer.id, id));
    if (!deleted) return c.json({ error: { code: 'not_found', message: 'No such watch.' } }, 404);
    return c.json({ deleted: true });
  });

  routes.get('/api/v1/notifications', async (c) => {
    const viewer = signedIn(c);
    if (viewer instanceof Response) return viewer;
    c.header('cache-control', 'private, no-store');
    const { pool } = c.get('deps');
    const url = new URL(c.req.url);
    const unreadOnly = url.searchParams.get('unread') === 'true';
    const [items, unread] = await Promise.all([
      listNotifications(pool, viewer.id, {
        unreadOnly,
        limit: Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50,
      }),
      unreadNotifications(pool, viewer.id),
    ]);
    return c.json({ items, unread });
  });

  /** Mark all read, or one: `{ "id": "..." }`. */
  routes.post('/api/v1/notifications/read', async (c) => {
    const viewer = signedIn(c);
    if (viewer instanceof Response) return viewer;
    const input = await body(c);
    const id = typeof input['id'] === 'string' && isUuid(input['id']) ? input['id'] : undefined;
    const changed = await markNotificationsRead(c.get('deps').pool, viewer.id, id);
    return c.json({ read: changed });
  });

  routes.get('/api/v1/push/key', async (c) => {
    const keys = await pushKeys(c.get('deps').pool);
    return c.json({ publicKey: keys.publicKey });
  });

  routes.post('/api/v1/push/subscriptions', async (c) => {
    const viewer = signedIn(c);
    if (viewer instanceof Response) return viewer;
    const input = await body(c);
    const subscription = parseSubscription(input['subscription'] ?? input);
    if (subscription === null) {
      return c.json(
        {
          error: {
            code: 'invalid',
            message: 'Send the PushSubscription as the browser gives it: endpoint and keys.',
          },
        },
        400,
      );
    }
    await saveSubscription(c.get('deps').pool, viewer.id, subscription);
    return c.json({ subscribed: true }, 201);
  });

  routes.delete('/api/v1/push/subscriptions', async (c) => {
    const viewer = signedIn(c);
    if (viewer instanceof Response) return viewer;
    const input = await body(c);
    const endpoint = typeof input['endpoint'] === 'string' ? input['endpoint'] : '';
    const deleted =
      endpoint !== '' && (await deleteSubscription(c.get('deps').pool, viewer.id, endpoint));
    return c.json({ deleted });
  });

  // --- pages ----------------------------------------------------------------

  routes.get('/notifications', async (c) => {
    const viewer = requireViewer(c);
    if (viewer instanceof Response) return viewer;
    const { pool } = c.get('deps');
    const [notifications, watches, keys, pushCount] = await Promise.all([
      listNotifications(pool, viewer.id),
      listWatches(pool, viewer.id, pathForQuery),
      pushKeys(pool).catch(() => null),
      subscriptionCount(pool, viewer.id),
    ]);
    // Reading the page is reading them; the badge clears on the next one.
    await markNotificationsRead(pool, viewer.id);
    const notice = new URL(c.req.url).searchParams.get('notice');
    return c.html(
      <Layout {...shell(c)} title="Notifications" noindex>
        <NotificationsPage
          notifications={notifications}
          watches={watches}
          pushKey={keys?.publicKey ?? null}
          pushCount={pushCount}
          {...(notice === null ? {} : { notice })}
        />
      </Layout>,
    );
  });

  /** The Watch button on a search page. */
  routes.post('/notifications/watches', async (c) => {
    const viewer = requireViewer(c);
    if (viewer instanceof Response) return viewer;
    const form = await formOf(c);
    const query = parseQuery(new URLSearchParams(form['query'] ?? ''));
    const result = await createWatch(
      c.get('deps').pool,
      viewer.id,
      query,
      { email: form['email'] !== 'off' },
      pathForQuery,
    );
    const notice =
      typeof result === 'string'
        ? result
        : result.created
          ? `Watching ${result.watch.label}.`
          : `Already watching ${result.watch.label}.`;
    return c.redirect(`/notifications?notice=${encodeURIComponent(notice)}`, 303);
  });

  routes.post('/notifications/watches/:id/delete', async (c) => {
    const viewer = requireViewer(c);
    if (viewer instanceof Response) return viewer;
    const id = c.req.param('id');
    if (isUuid(id)) await deleteWatch(c.get('deps').pool, viewer.id, id);
    return c.redirect('/notifications', 303);
  });

  return routes;
}
