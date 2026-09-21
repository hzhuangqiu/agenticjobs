/**
 * Agents, and who operates them.
 *
 * The board's thesis is agents hiring agents with a person controlling both
 * ends, and until now the person was the only end the schema could name. An
 * agent row is the other one. It belongs to an account, which is its sysop:
 * the person answerable for what it does here. It carries the skills it has,
 * which are required, because a registry of agents that cannot say what each
 * one does is a list of names. And it may name another agent as its
 * operator, so a swarm where one agent dispatches work to others is written
 * down as a tree rather than as a paragraph in somebody's resume.
 *
 * The operator relation stays inside one account. An agent of yours cannot
 * be claimed as the operator of an agent of mine: that would let anybody
 * publish an org chart with somebody else's agents in it.
 */

import type pg from 'pg';
import { clean, parseList, slugify, suffix } from '../schema/text.ts';

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 2000;
export const SKILLS_MAX = 20;
export const SKILL_MAX = 40;
export const AGENTS_PER_ACCOUNT = 100;

export class AgentProblem extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly field: string | undefined;
  constructor(message: string, status: 400 | 403 | 404 | 409 = 400, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export interface AgentRef {
  slug: string;
  name: string;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  skills: string[];
  description: string;
  url: string | null;
  public: boolean;
  /** The agent that runs this one, or null when the owner drives it directly. */
  operator: AgentRef | null;
  /** The agents this one runs. */
  operates: AgentRef[];
  owner: { name: string | null; candidateSlug: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface AgentInput {
  name?: unknown;
  skills?: unknown;
  description?: unknown;
  url?: unknown;
  /** Slug of the operating agent, empty string or null to clear. */
  operator?: unknown;
  public?: unknown;
}

interface AgentRow {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  skills: string[];
  description: string;
  url: string | null;
  operator_id: string | null;
  public: boolean;
  created_at: string;
  updated_at: string;
  operator_slug: string | null;
  operator_name: string | null;
  owner_name: string | null;
  candidate_slug: string | null;
}

const SELECT = `
  select a.id, a.owner_id, a.slug, a.name, a.skills, a.description, a.url, a.operator_id,
         a.public, a.created_at, a.updated_at,
         op.slug as operator_slug, op.name as operator_name,
         u.name as owner_name,
         (select r.public_slug from resumes r
           where r.user_id = a.owner_id and r.visibility = 'public' and r.public_slug is not null
           order by r.created_at asc limit 1) as candidate_slug
    from agents a
    join users u on u.id = a.owner_id
    left join agents op on op.id = a.operator_id`;

/**
 * Skills, as a list.
 *
 * Accepts the shapes a skill list arrives in: an array from JSON, a comma
 * separated string from a form or a `--skills` flag, or a newline separated
 * one from a textarea. Lowercased and deduplicated, because "Rust" and "rust"
 * are one skill and a search for either has to find this agent.
 */
export function normaliseSkills(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,\n]/) : [];
  const seen = new Set<string>();
  for (const item of parseList(raw, SKILLS_MAX * 2, SKILL_MAX)) {
    const skill = item.toLowerCase().replace(/\s+/g, ' ');
    if (skill !== '' && !seen.has(skill)) seen.add(skill);
  }
  return [...seen].slice(0, SKILLS_MAX);
}

function normaliseUrl(value: unknown): string | null {
  const text = clean(value, 500);
  if (text === '') return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function toAgent(row: AgentRow, operates: AgentRef[]): Agent {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    skills: row.skills ?? [],
    description: row.description,
    url: row.url,
    public: row.public,
    operator:
      row.operator_slug === null || row.operator_name === null
        ? null
        : { slug: row.operator_slug, name: row.operator_name },
    operates,
    owner: { name: row.owner_name, candidateSlug: row.candidate_slug },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function operatesOf(pool: pg.Pool, ids: string[]): Promise<Map<string, AgentRef[]>> {
  const out = new Map<string, AgentRef[]>();
  if (ids.length === 0) return out;
  const rows = await pool.query<{ operator_id: string; slug: string; name: string }>(
    `select operator_id, slug, name from agents where operator_id = any($1::uuid[]) order by name`,
    [ids],
  );
  for (const row of rows.rows) {
    const list = out.get(row.operator_id) ?? [];
    list.push({ slug: row.slug, name: row.name });
    out.set(row.operator_id, list);
  }
  return out;
}

async function hydrate(pool: pg.Pool, rows: AgentRow[]): Promise<Agent[]> {
  const operates = await operatesOf(
    pool,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toAgent(row, operates.get(row.id) ?? []));
}

/** Every agent an account operates, newest last. */
export async function listAgents(pool: pg.Pool, ownerId: string): Promise<Agent[]> {
  const rows = await pool.query<AgentRow>(
    `${SELECT} where a.owner_id = $1 order by a.created_at asc`,
    [ownerId],
  );
  return hydrate(pool, rows.rows);
}

/** The public directory: agents whose owners chose to list them. */
export async function listPublicAgents(
  pool: pg.Pool,
  options: { skill?: string | null; limit?: number } = {},
): Promise<Agent[]> {
  const params: unknown[] = [];
  const where = [`a.public`];
  const skill = options.skill?.trim().toLowerCase() ?? '';
  if (skill !== '') {
    params.push(skill);
    where.push(`$${params.length} = any(a.skills)`);
  }
  params.push(Math.min(200, Math.max(1, options.limit ?? 100)));
  const rows = await pool.query<AgentRow>(
    `${SELECT} where ${where.join(' and ')} order by a.created_at desc limit $${params.length}`,
    params,
  );
  return hydrate(pool, rows.rows);
}

/** One agent by slug. Private agents are visible to their owner only. */
export async function getAgent(
  pool: pg.Pool,
  slug: string,
  viewerId: string | null,
): Promise<Agent | null> {
  const rows = await pool.query<AgentRow>(`${SELECT} where a.slug = $1`, [slug]);
  const row = rows.rows[0];
  if (row === undefined) return null;
  if (!row.public && row.owner_id !== viewerId) return null;
  return (await hydrate(pool, [row]))[0] ?? null;
}

async function ownedRow(pool: pg.Pool, slug: string, ownerId: string): Promise<AgentRow> {
  const rows = await pool.query<AgentRow>(`${SELECT} where a.slug = $1`, [slug]);
  const row = rows.rows[0];
  if (row === undefined || row.owner_id !== ownerId) {
    throw new AgentProblem(`You have no agent called "${slug}".`, 404);
  }
  return row;
}

/**
 * Resolve the operator named in an input, within the owner's own agents.
 * Returns undefined when the input did not mention one, null to clear.
 */
async function operatorIdOf(
  pool: pg.Pool,
  ownerId: string,
  input: AgentInput,
  selfId: string | null,
): Promise<string | null | undefined> {
  if (input.operator === undefined) return undefined;
  const slug = clean(input.operator, 80);
  if (slug === '') return null;
  const rows = await pool.query<{ id: string; owner_id: string }>(
    `select id, owner_id from agents where slug = $1`,
    [slug],
  );
  const row = rows.rows[0];
  if (row === undefined || row.owner_id !== ownerId) {
    throw new AgentProblem(
      `"${slug}" is not one of your agents. An operator has to be an agent you registered.`,
      400,
      'operator',
    );
  }
  if (selfId !== null && row.id === selfId) {
    throw new AgentProblem('An agent cannot operate itself.', 400, 'operator');
  }
  // No cycles: walking up from the proposed operator must never reach this
  // agent, or "who runs this" has no answer.
  let cursor: string | null = row.id;
  for (let depth = 0; cursor !== null && depth < 50; depth += 1) {
    if (cursor === selfId) {
      throw new AgentProblem(
        `That would make ${slug} operate an agent that already operates it.`,
        400,
        'operator',
      );
    }
    const up: { rows: { operator_id: string | null }[] } = await pool.query(
      `select operator_id from agents where id = $1`,
      [cursor],
    );
    cursor = up.rows[0]?.operator_id ?? null;
  }
  return row.id;
}

/** Register an agent under an account. Skills are required. */
export async function registerAgent(
  pool: pg.Pool,
  ownerId: string,
  input: AgentInput,
): Promise<Agent> {
  const name = clean(input.name, NAME_MAX);
  if (name.length < 2)
    throw new AgentProblem('Give the agent a name of at least 2 characters.', 400, 'name');
  const skills = normaliseSkills(input.skills);
  if (skills.length === 0) {
    throw new AgentProblem(
      'List at least one skill the agent has, so it can be matched to work: --skills "rust, code review".',
      400,
      'skills',
    );
  }
  const count = await pool.query<{ n: number }>(
    `select count(*)::int as n from agents where owner_id = $1`,
    [ownerId],
  );
  if ((count.rows[0]?.n ?? 0) >= AGENTS_PER_ACCOUNT) {
    throw new AgentProblem(`An account can register up to ${AGENTS_PER_ACCOUNT} agents.`, 409);
  }
  const operatorId = (await operatorIdOf(pool, ownerId, input, null)) ?? null;

  const base = slugify(name);
  let slug = base;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const taken = await pool.query(`select 1 from agents where slug = $1`, [slug]);
    if (taken.rows.length === 0) break;
    slug = `${base}-${suffix(4)}`;
  }

  const inserted = await pool.query<{ slug: string }>(
    `insert into agents (owner_id, slug, name, skills, description, url, operator_id, public)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning slug`,
    [
      ownerId,
      slug,
      name,
      skills,
      clean(input.description, DESCRIPTION_MAX, { multiline: true }),
      normaliseUrl(input.url),
      operatorId,
      input.public === undefined ? true : flag(input.public),
    ],
  );
  const created = await getAgent(pool, inserted.rows[0]?.slug ?? slug, ownerId);
  if (created === null) throw new Error('agent insert returned no row');
  return created;
}

function flag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return text === '1' || text === 'true' || text === 'on' || text === 'yes';
}

/** Change what is written about an agent. Only the fields sent are touched. */
export async function updateAgent(
  pool: pg.Pool,
  ownerId: string,
  slug: string,
  input: AgentInput,
): Promise<Agent> {
  const row = await ownedRow(pool, slug, ownerId);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (input.name !== undefined) {
    const name = clean(input.name, NAME_MAX);
    if (name.length < 2)
      throw new AgentProblem('Give the agent a name of at least 2 characters.', 400, 'name');
    set('name', name);
  }
  if (input.skills !== undefined) {
    const skills = normaliseSkills(input.skills);
    if (skills.length === 0) {
      throw new AgentProblem(
        'An agent keeps at least one skill; send the full list to replace it.',
        400,
        'skills',
      );
    }
    set('skills', skills);
  }
  if (input.description !== undefined) {
    set('description', clean(input.description, DESCRIPTION_MAX, { multiline: true }));
  }
  if (input.url !== undefined) set('url', normaliseUrl(input.url));
  if (input.public !== undefined) set('public', flag(input.public));
  const operatorId = await operatorIdOf(pool, ownerId, input, row.id);
  if (operatorId !== undefined) set('operator_id', operatorId);

  if (sets.length > 0) {
    params.push(row.id);
    await pool.query(
      `update agents set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`,
      params,
    );
  }
  const updated = await getAgent(pool, row.slug, ownerId);
  if (updated === null) throw new Error('agent vanished during update');
  return updated;
}

/**
 * Name one agent as the operator of others, in one call.
 *
 * "Register agent A as the sysop of agents B and C" is the sentence this is
 * for. Every agent named has to be the caller's own.
 */
export async function assignOperator(
  pool: pg.Pool,
  ownerId: string,
  operatorSlug: string,
  agentSlugs: string[],
): Promise<Agent> {
  const operator = await ownedRow(pool, operatorSlug, ownerId);
  for (const slug of agentSlugs) {
    await updateAgent(pool, ownerId, slug, { operator: operator.slug });
  }
  const refreshed = await getAgent(pool, operator.slug, ownerId);
  if (refreshed === null) throw new Error('operator vanished during assignment');
  return refreshed;
}

export async function deleteAgent(pool: pg.Pool, ownerId: string, slug: string): Promise<void> {
  const row = await ownedRow(pool, slug, ownerId);
  await pool.query(`delete from agents where id = $1`, [row.id]);
}

/** Skills across public agents, most common first. */
export async function agentSkillCounts(
  pool: pg.Pool,
  limit = 50,
): Promise<{ skill: string; count: number }[]> {
  const rows = await pool.query<{ skill: string; count: number }>(
    `select s as skill, count(*)::int as count
       from agents a, unnest(a.skills) as s
      where a.public
      group by s order by count desc, s asc limit $1`,
    [limit],
  );
  return rows.rows;
}
