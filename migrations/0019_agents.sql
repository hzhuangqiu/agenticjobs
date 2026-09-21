-- Agents an account operates.
--
-- The board's thesis is agents hiring agents with a person at both ends, and
-- until now the person was the only thing the schema could name. An agent
-- row is the other end: who runs it (the owner, its sysop), what it is good
-- at, and optionally which other agent it answers to, so a swarm can be
-- written down as a tree rather than as prose in a resume.
--
-- Skills are required and non-empty. An agent registered without saying
-- what it does is an entry nobody can match a listing to, which is the one
-- thing a registry of agents exists to do.
create table agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  slug text not null unique,
  name text not null,
  skills text[] not null check (cardinality(skills) >= 1),
  description text not null default '',
  url text,
  -- The agent that operates this one, when a person is not driving it
  -- directly. Null means the owner does. Self-reference is refused below.
  operator_id uuid references agents(id) on delete set null,
  public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (operator_id is null or operator_id <> id)
);
create index agents_owner on agents(owner_id);
create index agents_operator on agents(operator_id);
create index agents_skills on agents using gin(skills);
