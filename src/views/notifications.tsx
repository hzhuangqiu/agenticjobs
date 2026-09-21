/**
 * Notifications and the watches that produce them.
 */

import type { FC } from 'hono/jsx';
import type { Notification, Watch } from '../core/watches.ts';
import { ago } from '../schema/text.ts';
import { Card, Empty } from './layout.tsx';

export const NotificationsPage: FC<{
  notifications: Notification[];
  watches: Watch[];
  /** The VAPID public key, or null when push is off on this board. */
  pushKey: string | null;
  pushCount: number;
  notice?: string;
}> = ({ notifications, watches, pushKey, pushCount, notice }) => (
  <div class="stack">
    <div>
      <h1>Notifications</h1>
      <p class="lede">
        New listings matching the searches you watch. Also by email, and in this browser if you ask.
      </p>
    </div>
    {notice !== undefined && <p role="status">{notice}</p>}

    <Card>
      <div class="card-header">
        <h2 class="card-title">Watching</h2>
        <p class="card-description">
          Run a search, then press Watch on it. From a terminal:{' '}
          <code>agenticjobs watch rust --remote</code>.
        </p>
      </div>
      {watches.length === 0 ? (
        <p class="small muted">Not watching anything yet.</p>
      ) : (
        <ul class="stack" style="gap:.5rem">
          {watches.map((watch) => (
            <li class="row" style="align-items:center;gap:.5rem;flex-wrap:wrap">
              <a href={watch.path}>{watch.label}</a>
              <span class="small muted">
                {watch.email ? 'email on' : 'email off'}
                {watch.lastNotifiedAt !== null && ` - last ${ago(watch.lastNotifiedAt)}`}
              </span>
              <form
                method="post"
                action={`/notifications/watches/${watch.id}/delete`}
                style="display:inline"
              >
                <button class="btn btn-ghost btn-sm" type="submit">
                  Stop watching
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Card>

    <Card>
      <div class="card-header">
        <h2 class="card-title">This browser</h2>
        <p class="card-description">
          {pushKey === null
            ? 'Browser notifications are not available on this board.'
            : pushCount > 0
              ? `Pushing to ${pushCount} browser${pushCount === 1 ? '' : 's'}.`
              : 'Get a notification here the moment a matching listing goes live, even with the tab closed.'}
        </p>
      </div>
      {pushKey !== null && (
        <>
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            id="push-enable"
            data-key={pushKey}
            hidden
          >
            Notify me in this browser
          </button>
          <button class="btn btn-ghost btn-sm" type="button" id="push-disable" hidden>
            Stop notifying this browser
          </button>
          <p class="small error-text" id="push-error" hidden></p>
          <noscript>
            <p class="small muted">Browser notifications need the site script.</p>
          </noscript>
        </>
      )}
    </Card>

    <section class="stack">
      <h2>Recent</h2>
      {notifications.length === 0 ? (
        <Empty>
          <p>Nothing yet.</p>
          <p class="small">When a listing matches a watch, it appears here.</p>
        </Empty>
      ) : (
        <ul class="thread-list">
          {notifications.map((item) => (
            <li class={item.readAt === null ? 'thread unread' : 'thread'}>
              {item.url === null ? (
                <strong>{item.title}</strong>
              ) : (
                <a href={item.url}>
                  <strong>{item.title}</strong>
                </a>
              )}
              <div class="small muted">
                {item.body} {ago(item.createdAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
);
