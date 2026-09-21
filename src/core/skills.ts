/**
 * Which skills the board is about, counted from what is actually on it.
 *
 * A tag on a published listing is a skill somebody is hiring for; a skill on
 * a public agent is one somebody is offering. Both are counted, and the
 * footer and the /skills index rank by the sum, so the words that link out
 * of every page are the words the board's own content uses most.
 *
 * Cached in process for a few minutes. The footer is on every page and this
 * is two group-bys; the counts do not need to be exact to the second.
 */

import type pg from 'pg';
import { isFilterWord } from './landing.ts';

export interface SkillCount {
  skill: string;
  jobs: number;
  agents: number;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; rows: SkillCount[] } | null = null;

export async function skillCounts(
  pool: pg.Pool,
  options: { fresh?: boolean } = {},
): Promise<SkillCount[]> {
  if (options.fresh !== true && cache !== null && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await pool.query<{ skill: string; jobs: number; agents: number }>(
    `with job_tags as (
       select lower(t) as skill, count(distinct j.id)::int as jobs
         from jobs j, unnest(array_cat(j.tags, j.stack)) as t
        where j.status = 'published' and j.published_at is not null and j.published_at <= now()
          and (j.expires_at is null or j.expires_at > now())
        group by lower(t)
     ), agent_skills as (
       select lower(s) as skill, count(*)::int as agents
         from agents a, unnest(a.skills) as s
        where a.public
        group by lower(s)
     )
     select coalesce(j.skill, a.skill) as skill, coalesce(j.jobs, 0) as jobs, coalesce(a.agents, 0) as agents
       from job_tags j full outer join agent_skills a on a.skill = j.skill
      order by coalesce(j.jobs, 0) + coalesce(a.agents, 0) desc, skill asc
      limit 300`,
  );
  const out = rows.rows.filter((row) => row.skill !== '' && !isFilterWord(row.skill));
  cache = { at: Date.now(), rows: out };
  return out;
}

/** Forget the cache; tests and the seed call this after writing. */
export function forgetSkillCounts(): void {
  cache = null;
}

/** The handful for the footer. */
export async function popularSkills(pool: pg.Pool, limit = 10): Promise<SkillCount[]> {
  const rows = await skillCounts(pool);
  return rows.filter((row) => row.jobs > 0).slice(0, limit);
}
