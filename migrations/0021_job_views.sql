-- How often each listing is read, per day.
--
-- A daily count rather than a row per read, because the only question asked
-- of it is "which listings are being looked at this week", and that question
-- does not need a timestamp per visitor. It feeds the popularity ranking and
-- nothing else.
create table job_views (
  job_id uuid not null references jobs(id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  primary key (job_id, day)
);
create index job_views_day on job_views(day);
