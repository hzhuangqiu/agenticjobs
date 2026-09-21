-- Watches, notifications and browser push.
--
-- A watch is a search somebody wants to hear about: the same JobQuery the
-- page and the API run, stored as JSON so the match is made by the same
-- where clause that produced the results they were looking at. When a
-- listing is published it is checked against every watch, and each match
-- becomes a notification row here, an email if the watch asked for one, and
-- a push message to any browser that subscribed.
create table watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  query jsonb not null,
  label text not null,
  email boolean not null default true,
  created_at timestamptz not null default now(),
  last_notified_at timestamptz
);
create index watches_user on watches(user_id);
-- The same search twice is one watch, not two emails per listing.
create unique index watches_user_query on watches(user_id, query);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_created on notifications(user_id, created_at desc);
create index notifications_user_unread on notifications(user_id) where read_at is null;

create table push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on push_subscriptions(user_id);

-- The VAPID key pair, generated once by the board itself so that turning
-- push on is not a step anybody has to remember. One row, ever.
create table push_keys (
  id boolean primary key default true check (id),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
